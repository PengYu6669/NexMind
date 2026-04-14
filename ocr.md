```bash label=Bash
curl -i -k 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate\_basic?access\_token=【调用鉴权接口获取的token】' --data 'image=【图片Base64编码，需UrlEncode】' -H 'Content-Type:application/x-www-form-urlencoded'
```
```python label=Python
# encoding:utf-8

import requests
import base64

'''
通用文字识别（高精度版）
'''

request\_url = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate\_basic"
# 二进制方式打开图片文件
f = open('[本地文件]', 'rb')
img = base64.b64encode(f.read())

params = {"image":img}
access\_token = '[调用鉴权接口获取的token]'
request\_url = request\_url + "?access\_token=" + access\_token
headers = {'content-type': 'application/x-www-form-urlencoded'}
response = requests.post(request\_url, data=params, headers=headers)
if response:
 print (response.json())
```
```java label=JAVA
package com.baidu.ai.aip;

import com.baidu.ai.aip.utils.Base64Util;
import com.baidu.ai.aip.utils.FileUtil;
import com.baidu.ai.aip.utils.HttpUtil;

import java.net.URLEncoder;

/\*\*
\* 通用文字识别（高精度版）
\*/
public class AccurateBasic {

 /\*\*
 \* 重要提示代码中所需工具类
 \* FileUtil,Base64Util,HttpUtil,GsonUtils请从
 \* https://ai.baidu.com/file/658A35ABAB2D404FBF903F64D47C1F72
 \* https://ai.baidu.com/file/C8D81F3301E24D2892968F09AE1AD6E2
 \* https://ai.baidu.com/file/544D677F5D4E4F17B4122FBD60DB82B3
 \* https://ai.baidu.com/file/470B3ACCA3FE43788B5A963BF0B625F3
 \* 下载
 \*/
 public static String accurateBasic() {
 // 请求url
 String url = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate\_basic";
 try {
 // 本地文件路径
 String filePath = "[本地文件路径]";
 byte[] imgData = FileUtil.readFileByBytes(filePath);
 String imgStr = Base64Util.encode(imgData);
 String imgParam = URLEncoder.encode(imgStr, "UTF-8");

 String param = "image=" + imgParam;

 // 注意这里仅为了简化编码每一次请求都去获取access\_token，线上环境access\_token有过期时间， 客户端可自行缓存，过期后重新获取。
 String accessToken = "[调用鉴权接口获取的token]";

 String result = HttpUtil.post(url, accessToken, param);
 System.out.println(result);
 return result;
 } catch (Exception e) {
 e.printStackTrace();
 }
 return null;
 }

 public static void main(String[] args) {
 AccurateBasic.accurateBasic();
 }
}
```
```cpp label=C++
#include 
#include 

// libcurl库下载链接：https://curl.haxx.se/download.html
// jsoncpp库下载链接：https://github.com/open-source-parsers/jsoncpp/
const static std::string request\_url = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate\_basic";
static std::string accurateBasic\_result;
/\*\*
\* curl发送http请求调用的回调函数，回调函数中对返回的json格式的body进行了解析，解析结果储存在全局的静态变量当中
\* @param 参数定义见libcurl文档
\* @return 返回值定义见libcurl文档
\*/
static size\_t callback(void \*ptr, size\_t size, size\_t nmemb, void \*stream) {
 // 获取到的body存放在ptr中，先将其转换为string格式
 accurateBasic\_result = std::string((char \*) ptr, size \* nmemb);
 return size \* nmemb;
}
/\*\*
\* 通用文字识别（高精度版）
\* @return 调用成功返回0，发生错误返回其他错误码
\*/
int accurateBasic(std::string &json\_result, const std::string &access\_token) {
 std::string url = request\_url + "?access\_token=" + access\_token;
 CURL \*curl = NULL;
 CURLcode result\_code;
 int is\_success;
 curl = curl\_easy\_init();
 if (curl) {
 curl\_easy\_setopt(curl, CURLOPT\_URL, url.data());
 curl\_easy\_setopt(curl, CURLOPT\_POST, 1);
 curl\_httppost \*post = NULL;
 curl\_httppost \*last = NULL;
 curl\_formadd(&post, &last, CURLFORM\_COPYNAME, "image", CURLFORM\_COPYCONTENTS, "【base64\_img】", CURLFORM\_END);

 curl\_easy\_setopt(curl, CURLOPT\_HTTPPOST, post);
 curl\_easy\_setopt(curl, CURLOPT\_WRITEFUNCTION, callback);
 result\_code = curl\_easy\_perform(curl);
 if (result\_code != CURLE\_OK) {
 fprintf(stderr, "curl\_easy\_perform() failed: %s\n",
 curl\_easy\_strerror(result\_code));
 is\_success = 1;
 return is\_success;
 }
 json\_result = accurateBasic\_result;
 curl\_easy\_cleanup(curl);
 is\_success = 0;
 } else {
 fprintf(stderr, "curl\_easy\_init() failed.");
 is\_success = 1;
 }
 return is\_success;
}

```
```php label=PHP
php
/\*\*
\* 发起http post请求(REST API), 并获取REST请求的结果
\* @param string $url
\* @param string $param
\* @return - http response body if succeeds, else false.
\*/
function request\_post($url = '', $param = '')
{
 if (empty($url) || empty($param)) {
 return false;
 }

 $postUrl = $url;
 $curlPost = $param;
 // 初始化curl
 $curl = curl\_init();
 curl\_setopt($curl, CURLOPT\_URL, $postUrl);
 curl\_setopt($curl, CURLOPT\_HEADER, 0);
 // 要求结果为字符串且输出到屏幕上
 curl\_setopt($curl, CURLOPT\_RETURNTRANSFER, 1);
 curl\_setopt($curl, CURLOPT\_SSL\_VERIFYPEER, false);
 // post提交方式
 curl\_setopt($curl, CURLOPT\_POST, 1);
 curl\_setopt($curl, CURLOPT\_POSTFIELDS, $curlPost);
 // 运行curl
 $data = curl\_exec($curl);
 curl\_close($curl);

 return $data;
}

$token = '[调用鉴权接口获取的token]';
$url = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate\_basic?access\_token=' . $token;
$img = file\_get\_contents('[本地文件路径]');
$img = base64\_encode($img);
$bodys = array(
 'image' = $img
);
$res = request\_post($url, $bodys);

var\_dump($res);

```
```csharp label=C#
using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;

namespace com.baidu.ai
{
 public class AccurateBasic
 {
 // 通用文字识别（高精度版）
 public static string accurateBasic()
 {
 string token = "[调用鉴权接口获取的token]";
 string host = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate\_basic?access\_token=" + token;
 Encoding encoding = Encoding.Default;
 HttpWebRequest request = (HttpWebRequest)WebRequest.Create(host);
 request.Method = "post";
 request.KeepAlive = true;
 // 图片的base64编码
 string base64 = getFileBase64("[本地图片文件]");
 String str = "image=" + HttpUtility.UrlEncode(base64);
 byte[] buffer = encoding.GetBytes(str);
 request.ContentLength = buffer.Length;
 request.GetRequestStream().Write(buffer, 0, buffer.Length);
 HttpWebResponse response = (HttpWebResponse)request.GetResponse();
 StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.Default);
 string result = reader.ReadToEnd();
 Console.WriteLine("通用文字识别（高精度版）:");
 Console.WriteLine(result);
 return result;
 }

 public static String getFileBase64(String fileName) {
 FileStream filestream = new FileStream(fileName, FileMode.Open);
 byte[] arr = new byte[filestream.Length];
 filestream.Read(arr, 0, (int)filestream.Length);
 string baser64 = Convert.ToBase64String(arr);
 filestream.Close();
 return baser64;
 }
 }
}

```
