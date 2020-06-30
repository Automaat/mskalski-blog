---
title: "Why my HTTP request did not timed out? Quick tour inside JDK and OkHttpClient for better understanding of timeouts"
date: 2019-12-13T07:45:47+01:00
draft: false
author: "Marcin Skalski"
---

So you have JVM based service (A) that is communicating with another service (B) using some kind of HTTP client. 
You know what you are doing so you gathered metrics statistics from your dependency. Especially it’s response times. 
Let’s assume that p99 of its response times form service B are 200ms. Also, this service is fairly close to you for example in the 
same data center. You adjusted your timeouts accordingly, for example, you’ve set `connection timeout` to 50ms 
and `socket timeout` to 250ms.  Everything works fine but you are really thorough, have great 
observability in your service and monitor metrics regularly. One day you noticed something:

![](/images/2019/12/grafana.png)
 
Wait, what? How is this even possible? You have set timeouts and in the 
worst-case scenario, your requests should be timed out after 250ms.

Connection timeout restricts how long we will wait until the connection is established. So the result can be 
either an open connection or unreachable host. So there shouldn’t be any problems. Let's take a look at socket timeout 
maybe we can find something interesting.

# "Talk is cheap, show me the code"
To get a better understanding of whats going on we could write a simple socket server and simple client. All of the code was 
written in java 11, on `AdoptOpenJDK 11.0.4`

Here is the code of server:
```java
public class Main {

    public static void main(String[] args) throws IOException, InterruptedException {
        //starting server
        try (var listener = new ServerSocket(59090)) {
            System.out.println("The simple server is running...");

            //message to send
            byte[] test = {1};

            while (true) {
                try (var socket = listener.accept()) {
                    System.out.println("Accepted connection");
                    OutputStream outputStream = socket.getOutputStream();
                    for (int i = 0; i < 200; i++) {
                        outputStream.write(test);
                    }
                    outputStream.close();
                }
            }
        }
    }
}
```

It is not rocket science, we are creating a new instance of `SocketServer` running on port `59090`. Next in line (9) we 
prepare the message that we will send and it is a single byte, we will be sending it 200 times. 
Next, we have an infinite loop that will wait for client connections and when this happens we will send 
him our message.

Now, let's take a look at the client: 
```java
public class SimpleClient {

    public static void main(String[] args) throws IOException {
        //creating socket with timeout
        var socket = new Socket("localhost", 59090);
        socket.setSoTimeout(100);

        //byte array to store output
        byte[] b = new byte[1024];

        long start = System.currentTimeMillis();

        var input = socket.getInputStream();
        var read = input.read(b, 0, 300);
        var offset = 0;
        while (offset <= 200 && read != -1) {
            offset += read;
            System.out.println("read: " + read + "bytes");
            read = input.read(b, offset, 200);
        }

        long finish = System.currentTimeMillis();
        long time = finish - start;
        System.out.println("Operation took: " + time);
        System.out.println("In total read " + offset + " bytes.");
    }
}
```
Not much to see here, we are creating new `Socket` instance that will connect to our localhost on port `59090` then we set 
`soTimout` to `100ms` this is what we will be monitoring. Next, there is a prepared byte array to store the response from our
server. With everything prepared we can start reading. We know that we should read `200 bytes` so we will read until we 
have collect 200 bytes and there is something to read. At the end to check if everything went well and we read the amount of 
bytes that were expected we can print our reading offset.
(Function `InputStream.read(byte b[], int off, int len)` returns amount of bytes that were read). 

Fantastic we have written some code so we can run it and measure how long it took to read the whole message.
I ran it a few times and got an average response of `17ms` and we have much time to spare until we reach the timeout. 
Now lets see what happens when connection becomes slower. To simulate it we will add sleep in our server just after we 
accept new connection:
```java
System.out.println("Accepted connection");
sleep(150);
OutputStream outputStream = socket.getOutputStream();
```
After running again our code we will get expected timeout exception :) 
```java
Exception in thread "main" java.net.SocketTimeoutException: Read timed out
	at java.base/java.net.SocketInputStream.socketRead0(Native Method)
	at java.base/java.net.SocketInputStream.socketRead(SocketInputStream.java:115)
	at java.base/java.net.SocketInputStream.read(SocketInputStream.java:168)
	at java.base/java.net.SocketInputStream.read(SocketInputStream.java:140)
	at com.skalski.SimpleClient.main(SimpleClient.java:17)
```
Everything works as expected. We can take a closer look right now what is going on inside of JDK code.
When we call `socket.setSoTimeout(100)`, this piece of code is executed:
 ```java
public synchronized void setSoTimeout(int timeout) throws SocketException {
        if (isClosed())
            throw new SocketException("Socket is closed");
        if (timeout < 0)
          throw new IllegalArgumentException("timeout can't be negative");

        getImpl().setOption(SocketOptions.SO_TIMEOUT, timeout);
    }
```
As we can see in line (7) `SocketOptions.SO_TIMEOUT` option is set on our `java.net.SocketImpl` class. 
In this scenario, `java.net.PlainSocketImpl` implementation of a socket is used. When we look at our client code in 
line (13) we get `InputStream` form our socket and it is `java.net.SocketInputStream`. Next in line (19) we are calling
`read(byte b[], int off, int len)` method, underneath it is using written in C method `Java_java_net_SocketInputStream_socketRead0`
This method is long and you do not need to read it all. (But I encourage you to do it 😉) The important for us is part: 
```c
if (timeout) {
    if (timeout <= 5000 || !isRcvTimeoutSupported) {
        int ret = NET_Timeout(fd, timeout);

        if (ret <= 0) {
            if (ret == 0) {
                JNU_ThrowByName(env, "java/net/SocketTimeoutException",
                                "Read timed out");
            } else if (ret == -1) {
                JNU_ThrowByName(env, "java/net/SocketException", "socket closed");
            }
            if (bufP != BUF) {
                free(bufP);
            }
            return -1;
        }

        /*check if the socket has been closed while we were in timeout*/
        newfd = (*env)->GetIntField(env, fdObj, IO_fd_fdID);
        if (newfd == -1) {
            JNU_ThrowByName(env, "java/net/SocketException", "Socket closed");
            if (bufP != BUF) {
                free(bufP);
            }
            return -1;
        }
    }
}
```
In the line (3) `NET_Timeout` function is called, when we look inside it we can see that it is calling operating system 
polling function that waits for events on file descriptor, in Linux it is `poll(2)` in BSD `select(2)` and `select(4)` in Windows.
For all of those functions timeout that we specified earlier is passed. Those polling functions will wait without blocking
until the end of our timeout or for events on file descriptors to occur. They return how many descriptors registered some events. 
In next steps errors are handled and `SocketTimeoutException` is thrown if polling function returned `-1` which means it 
timed out. If everything went well this piece of code is executed:
```c
nread = recv(fd, bufP, len, 0);
if (nread > 0) {
    (*env)->SetByteArrayRegion(env, data, off, nread, (jbyte *)bufP);
}
``` 

In line (1) `recv` function is called it is used to read bytes from the socket, then these bytes are populated to byte array
we have passed to `InputStream.read` function and number of read bytes is returned.

# Returning to our simple client
So we know how socket timeout work, it is pretty simple and it does what most of us probably thought it do. 
But it still did not explain why some of the requests to service B took more than timeout, so let's dig deeper.

What happens when we put our sleep just after sending the first byte? 
In our logs, we can see that we have read a single byte and then we got `SocketTimeoutException`, so our client read the first 
part of the message and then encountered a problem. But it was expected because the server took much longer to respond 
than we thought it will. I think we can test at least one more thing, we can play with our sleep time. Lets set it to `50ms`
 and run our code. Here is the result of execution:
```
Operation took: 10490
In total read 200 bytes.
```
Whaat? `Operation took: 10490` how is that even possible? We set `socketTimeout` to `100ms` and our connection took 
more than 10 seconds. Maybe there is some bug? Let's run it again:
```
Operation took: 10509
In total read 200 bytes.
```
Almost the same result. Can it be our original problem? Yes it is! It is almost exactly how `OkHttpClient` works. Here is 
code sample from this library: 
```java
private void readFrom(InputStream in, long byteCount, boolean forever) throws IOException {
    if (in == null) throw new IllegalArgumentException("in == null");
    while (byteCount > 0 || forever) {
      Segment tail = writableSegment(1);
      int maxToCopy = (int) Math.min(byteCount, Segment.SIZE - tail.limit);
      int bytesRead = in.read(tail.data, tail.limit, maxToCopy);
      if (bytesRead == -1) {
        if (forever) return;
        throw new EOFException();
      }
      tail.limit += bytesRead;
      size += bytesRead;
      byteCount -= bytesRead;
    }
  }
```
This client have to read the expected amount of data and will read in parts until whole message was send, so even if 
single byte was send via socket before timeout elapsed `SocketTimeoutException` will not be thrown.

### But how does it know how many bytes should it read?

The answer to this question is actually pretty simple. `HTTP` response has a predefined scheme. First of all, we have `Status line`
which contains status code, next we have `headers` and finally `message body`. Headers and body are separated with `CRLF`
Also one of the headers is `Content-Length` which indicates how long message body will be. So while receiving response 
from another service via `HTTP/1.1` we can calculate when to stop reading from the socket after receiving an appropriate amount 
of bytes.

![Http protocol](/images/2019/12/HTTP_Response.png)


# Summing up
After reading this short article you should know how timeouts work inside of `JDK` and why your request to another service
took longer than expected. The Most important piece of knowledge you should remember is that when you set `socketTimeout` for
example on `RestTemplate` while using Spring you set a timeout for every single read form socket which effectively becomes 
time from last bit of information after your connection will be interrupted. You should keep it in mind when you set timeouts
next time in your application and adjust them accordingly. Fortunately since `3.12.0` version of `OkHttp` client you can specify
call timeout `OkHttpClient.Builder.callTimeout()` which will limit whole operation time.

That all from me, thank you all for reading my first post. Feel free to let me know how you liked it, also I encourage
you to comment, ask questions and share the knowledge with your coworkers.  

## References
[Source code of examples used in this post](https://github.com/Automaat/extended_timeouts)

[OkHttp](https://github.com/square/okhttp/)

[JDK](https://hg.openjdk.java.net/jdk/jdk)