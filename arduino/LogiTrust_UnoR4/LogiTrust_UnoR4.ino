#include <WiFiS3.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <TinyGPSPlus.h>
#include <Crypto.h>
#include <SHA256.h>

// -------------------------------------------------------------
// CONFIGURATION
// -------------------------------------------------------------
const char* DEVICE_SECRET = "logitrust_hardware_key_2026";
// -------------------------------------------------------------
const char* ssid = "Your_SSID";
const char* password = "Your_PWD";

// MQTT Broker Configuration
// For local demo with Docker Mosquitto: set to your PC's LAN IP address (e.g., 192.168.1.100)
// For public cloud broker testing: set mqtt_server = "broker.hivemq.com"
const char* mqtt_server = "192.168.1.100"; // Replace with your PC LAN IP running Docker Mosquitto
const int mqtt_port = 1883;
const char* mqtt_topic = "logitrust/telemetry/uno-r4";

// DHT Sensor Configuration
#define DHTPIN 2
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// GPS Configuration
TinyGPSPlus gps;
// Hardware Serial1 on Arduino Uno R4 WiFi is connected to D0 (RX) and D1 (TX)

// -------------------------------------------------------------
// GLOBALS
// -------------------------------------------------------------
WiFiClient espClient;
PubSubClient client(espClient);
String sensorHardwareId = "";
unsigned long lastMsg = 0;

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());

  // Get MAC Address to use as the unique Sensor Hardware ID
  byte mac[6];
  WiFi.macAddress(mac);
  char macStr[18];
  sprintf(macStr, "%02X:%02X:%02X:%02X:%02X:%02X", mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]);
  sensorHardwareId = String(macStr);
  
  Serial.println("======================================");
  Serial.print("YOUR SENSOR HARDWARE ID IS: ");
  Serial.println(sensorHardwareId);
  Serial.println("======================================");
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    String clientId = "UnoR4Client-";
    clientId += String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str())) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  
  // Initialize GPS Serial Port (Serial1 corresponds to D0 and D1 on Uno R4)
  Serial1.begin(9600);
  
  // Initialize DHT sensor
  dht.begin();
  
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(512);
}

// Helper: Compute HMAC-SHA256 using standard SHA256 primitive
String computeHMAC(const char* key, const String& message) {
  uint8_t k[64];
  memset(k, 0, 64);
  size_t keyLen = strlen(key);
  if (keyLen > 64) {
    SHA256 kh;
    kh.update(key, keyLen);
    kh.finalize(k, 32);
  } else {
    memcpy(k, key, keyLen);
  }

  uint8_t k_ipad[64];
  uint8_t k_opad[64];
  for (int i = 0; i < 64; i++) {
    k_ipad[i] = k[i] ^ 0x36;
    k_opad[i] = k[i] ^ 0x5c;
  }

  SHA256 inner;
  inner.update(k_ipad, 64);
  inner.update(message.c_str(), message.length());
  uint8_t innerHash[32];
  inner.finalize(innerHash, 32);

  SHA256 outer;
  outer.update(k_opad, 64);
  outer.update(innerHash, 32);
  uint8_t mac[32];
  outer.finalize(mac, 32);

  String sig = "0x";
  for (int i = 0; i < 32; i++) {
    if (mac[i] < 16) sig += "0";
    sig += String(mac[i], HEX);
  }
  return sig;
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  
  // Feed GPS data to the TinyGPSPlus object continuously
  while (Serial1.available() > 0) {
    gps.encode(Serial1.read());
  }

  unsigned long now = millis();
  if (now - lastMsg > 5000) { // Send data every 5 seconds
    lastMsg = now;

    // Read real values from DHT22
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    
    // Skip publish on DHT read failure to avoid sending corrupt data
    if (isnan(temp) || isnan(hum)) {
      Serial.println("Error: Failed to read from DHT sensor! Skipping publish.");
      return;
    }
    
    // Read real values from GPS
    float lat = 0.0;
    float lon = 0.0;
    bool hasGpsLock = false;
    
    // Report gpsLock=true only if satellites >= 4, hdop < 5, and location age < 5s (5000ms)
    if (gps.location.isValid() &&
        gps.satellites.isValid() && (gps.satellites.value() >= 4) &&
        gps.hdop.isValid() && (gps.hdop.hdop() < 5.0) &&
        gps.location.age() < 5000) {
      lat = gps.location.lat();
      lon = gps.location.lng();
      hasGpsLock = true;
    }

    // Acquire synchronized real-time epoch from NTP via WiFi
    unsigned long unixTimestamp = WiFi.getTime();
    if (unixTimestamp == 0) {
      unixTimestamp = 1710000000 + (now / 1000);
    }
    
    String payload = "{";
    payload += "\"sensorId\":\"" + sensorHardwareId + "\",";
    payload += "\"temperature\":" + String(temp, 1) + ",";
    payload += "\"humidity\":" + String(hum, 1) + ",";
    payload += "\"timestamp\":" + String(unixTimestamp) + ",";
    payload += "\"latitude\":" + String(lat, 6) + ",";
    payload += "\"longitude\":" + String(lon, 6) + ",";
    payload += "\"gpsLock\":" + String(hasGpsLock ? "true" : "false") + ",";
    
    // Cryptographic Signature Generation: HMAC-SHA256 over ALL fields
    String hmacMessage = sensorHardwareId + ":" + String(unixTimestamp) + ":" + String(temp, 1) + ":" + String(hum, 1) + ":" + String(lat, 6) + ":" + String(lon, 6) + ":" + (hasGpsLock ? "true" : "false");
    String sig = computeHMAC(DEVICE_SECRET, hmacMessage);
    
    payload += "\"signature\": \"" + sig + "\"";

    payload += "}";

    Serial.print("Publishing message: ");
    Serial.println(payload);
    
    client.publish(mqtt_topic, payload.c_str());
  }
}
