---
title: "Why is it good practice to set -Xms along -Xmx java flag while using Concurrent Mark Sweep (CMS) collector?"
date: 2020-05-27T12:26:09+02:00
draft: false
---

Recently I stumbled upon an interesting issue in one of our services. When going through our Grafana dashboards I have discovered that
time spent in GC for this service is abnormally high. Immediately I started investigating this issue. The investigation was pretty quick 
and an issue was rather simple but it gave us a significant performance boost. So I decided to share it with you and shed some
light on how adaptive heap sizing in jvm works and how it can sometimes be a problem.

### Service overview
First, I want to tell you a little more about the service I was working with. In my opinion, it is the most complicated service
our team created. Mostly because it utilizes 3 databases (`MongoDb`(aggregated statistics for single notification), 
`Cassandra` (event store) and `ElasticSearch` (notifications full text search)) it internally uses `Kafka` 
(queue before DBs for reliability purposes) and was written in `Spring's Reactor`. 
The business purpose of this service is to track all notifications sent from our infrastructure. It aggregates few different events: 
* When the notification was sent
* If the notification was failed to send
* When the user opened a notification
* When the user clicked in any of the links inside of the notification

During the day we are observing traffic around `few thousands rps (requests per second)`. Here is an example of traffic from the most common day:

And normal p99 of responses time form tracker service:

![](/images/2020/05/typowy_p99.png)

As you can see it is disturbingly high.

The tracking service is running at 10 instances in a production environment. Every instance has **3GB** of memory committed as uses **2** processor cores.
In total it gives us **30GB** of memory and **20** processor cores. Which I think is a lot for the work it has to do.

### Looking through Grafana dashboards

I have discovered that most tracking service instances are spending 30 seconds out of minute in GC. Here is how it looks like on charts:

![](/images/2020/05/typowy_czas_w_gc.png)

Also, a number of GC collections were really high, almost 15k collection per 10 minutes:

![](/images/2020/05/typowa_ilosc_kolekcji.png)

I began investigation. I have downloaded gc.log for one instance. Using `JClarity's Censum` I have discovered that allocation rate was
around **1GB** and **1.8GB** in peaks, which was pretty high.

![](/images/2020/05/allocation_rates.png)

Moreover, there was huge percent of premature promotions, to be exact **52%**. I have assumed that this is because of this high allocation rates.

In the next step I have created and downloaded heap dump for this instance, to check contents of the heap. It was quite a surprise when I discovered
that it's size was only **42MB**. With this allocation rate, there was no surprise that `JVM` was spending thirty seconds out of 
minute in GC. The percent of premature promotions was that high because heap was only 42MB in size and object allocation rate was more than 1GB.
I cannot believe we deliberately set that small heaps, so I have checked the jvm properties from our configuration, and the only
heap size property that was set was `-Xmx2G`. My first reflex was to add `-Xms` property which I did right away.

### Adding -Xms along -Xmx

I have set **-Xms1g** and **-Xmx1g** and here are the results of this change:

![](/images/2020/05/xmx_czas_w_gc.png)

and 

![](/images/2020/05/xmx_kolekcje.png)

As we can see time spent in a GC was reduced significantly. Moreover, thanks to that response times from our service was also reduced

![](/images/2020/05/xmx_p99_event.png)

### Why this helped and why previously heap was only 40mb? 

When we don't set `-Xms` flag explicitly the initial heap size will be set to 1/64 of all available memory. 
Which in our case was around 31MB. We can control how fast JVM is resizing it's heap by setting flags: `-XX:MinHeapFreeRatio` 
and `-XX:MaxHeapFreeRatio` which defaults are 40% and 70%. This means that JVM will enlarge its heap after full gc when 
percent of free space is less than 40. On the other, hand heap size will shrink after full GC if there is more than 70% space free.
JVM is less eager to reduce heap size because it is more complicated operation and will take more time which will significantly 
affect application performance. This is default resizing policy and because objects that were allocated by our application was
dying young and most of them were removed after full GC we could never reach this `MinHeapFreeRatio` threshold. This is fragment
of our GC log:

```java
463.462: [GC (Allocation Failure) 463.462: [ParNew
    Desired survivor size 425984 bytes, new threshold 6 (max 6)
    - age   1:     386048 bytes,     386048 total
    : 7997K->606K(8000K), 0.0055859 secs] 80902K->73901K(178220K) icms_dc=13 , 0.0056746 secs] 
    [Times: user=0.01 sys=0.00, real=0.01 secs] 
463.473: [CMS-concurrent-abortable-preclean: 0.005/0.043 secs] 
    [Times: user=0.06 sys=0.01, real=0.04 secs] 
463.473: [GC (CMS Final Remark) [YG occupancy: 3754 K (8000 K)]
463.473: [Rescan (parallel) , 0.0040316 secs]
463.477: [weak refs processing, 0.0000878 secs]
463.477: [class unloading, 0.0269731 secs]
463.504: [scrub symbol table, 0.0243151 secs]
463.529: [scrub string table, 0.0014955 secs]
    [1 CMS-remark: 73295K(170220K)] 77049K(178220K), 0.0570683 secs] 
    [Times: user=0.06 sys=0.00, real=0.06 secs] 
463.531: [CMS-concurrent-sweep-start]
```

In line 14 we can see that live objects were occupying **77049KB** out of **178220KB** available memory on the heap. Which means there
was almost 60 percent of free space. And this was rather a standard situation after each full GC.

This problem occurred because we were using `Concurrent Mark Sweep` collector. **CMS does not** support adaptive sizing policy,
which is default for `Parallel` and `G1` collectors. With adaptive sizing there are three criteria taken into account when
deciding if the heap should be resized:

1. **Desired maximum GC pause goal** - if the GC pause time is greater than the pause time goal then reduce the sizes of the 
    generations to better attain the goal.
2. **Desired application throughput goal** - if the pause time goal is being met then consider the application's throughput goal. 
   If the application's throughput goal is not being met, then increase the sizes of the generations to better attain the goal.
3. **Minimum footprint** - if both the pause time goal and the throughput goal are being met, then the size of the 
   generations are decreased to reduce footprint.

However we were using CMS GC so we cannot rely on adaptive sizing. But we can compute how large heap we need.
 
### Looking at GC logs and finding the right values for Eden and tenuring space

Right now we have defined our heap size and to be **1GB**. But we have not specified the size of generations. Due to that CMS is
creating really small Eden there would be still a lot of collections in young generation. If we look again 
at allocation rates we can see that most of the time we are allocating around 800mb per second. It would be nice not to have
more than one collection per second. Our service is using around 200-300mb of memory for Spring and configuration and rest 
of the objects have really short lifespan. So we can set young generation size to **600mb** an old size to **400mb**. Here 
are the results of this change:

Typical young collection time (0.01 sec):
```java
5968.202: [GC (Allocation Failure) 5968.202: [ParNew
    Desired survivor size 31457280 bytes, new threshold 6 (max 6)
    - age   1:    1232984 bytes,    1232984 total
    - age   2:    2318608 bytes,    3551592 total
    - age   3:     302888 bytes,    3854480 total
    - age   4:     938800 bytes,    4793280 total
    - age   5:      69456 bytes,    4862736 total
    - age   6:      56680 bytes,    4919416 total
    : 498270K->5506K(552960K), 0.0078395 secs] 615145K->123035K(987136K) icms_dc=0 , 0.0079445 secs] 
    [Times: user=0.02 sys=0.00, real=0.01 secs] 
```

Typical old collection pause time(0.21sec): 

```java
27.719: [CMS-concurrent-abortable-preclean: 0.849/4.488 secs] [Times: user=11.33 sys=0.83, real=4.49 secs] 
27.720: [GC (CMS Final Remark) [YG occupancy: 256247 K (552960 K)]
27.720: [Rescan (parallel) , 0.1079998 secs]
27.828: [weak refs processing, 0.0002720 secs]
27.828: [class unloading, 0.0671273 secs]
27.895: [scrub symbol table, 0.0297383 secs]
27.925: [scrub string table, 0.0020253 secs]
    [1 CMS-remark: 46556K(434176K)] 302804K(987136K), 0.2098574 secs] 
    [Times: user=0.44 sys=0.10, real=0.21 secs] 
27.930: [CMS-concurrent-sweep-start]
27.961: [CMS-concurrent-sweep: 0.030/0.031 secs] [Times: user=0.15 sys=0.02, real=0.03 secs] 
27.961: [CMS-concurrent-reset-start]
27.962: [CMS-concurrent-reset: 0.001/0.001 secs] [Times: user=0.01 sys=0.00, real=0.00 secs] 
```

Number of collections per 10 minutes:

![](/images/2020/05/newSize_kolekcje.png)

Time spent in GC per minute:

![](/images/2020/05/newSize_czas_gc.png)

Also, overall usage of the processor was reduced thanks to that changes (first change at 11:00 and second at 16:00):

![](/images/2020/05/wszystkie_zmiany_cpu.png)

### Summary

To sum up, CMS does not have adaptive sizing policy and all changes to heap size are based only on free space after full GC.
Because of that, it is good practice to set not only max heap size by also min heap size, which should be based on how your application
allocates memory and how much does it need for normal functioning. Another thing you should be cautious about is how often 
GC is being performed and how long does it take to clean heap form garbage. Moreover, I want to point out how important it is
to look at GC metrics, analyze `gc.log` from time to time, and adjust JVM tuning to your actual workload. All the tuning I did
to this JVM is fine right now but after a few months, application or traffic could change and we will end up with a poorly tuned 
application. 

## References
[GC ergonomics - Oracle docs](https://docs.oracle.com/javase/7/docs/technotes/guides/vm/gc-ergonomics.html)

[jClarity Censum](https://www.jclarity.com/topics/products/censum/)