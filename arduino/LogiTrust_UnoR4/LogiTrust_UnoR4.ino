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

// HiveMQ Public Cloud Broker
const char* mqtt_server = "broker.hivemq.com"; 
const int mqtt_port = 1883;

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
    
    // Check if readings failed, set to 0.0 or a default if error occurs
    if (isnan(temp) || isnan(hum)) {
      Serial.println("Failed to read from DHT sensor!");
      temp = 0.0;
      hum = 0.0;
    }
    
    // Read real values from GPS
    float lat = 0.0;
    float lon = 0.0;
    bool hasGpsLock = false;
    
    if (gps.location.isValid()) {
      lat = gps.location.lat();
      lon = gps.location.lng();
      hasGpsLock = true;
    }

    unsigned long unixTimestamp = 1690000000 + (now / 1000);
    
    String payload = "{";
    payload += "\"sensorId\":\"" + sensorHardwareId + "\",";
    payload += "\"temperature\":" + String(temp, 1) + ",";
    payload += "\"humidity\":" + String(hum, 1) + ",";
    payload += "\"timestamp\":" + String(unixTimestamp) + ",";
    payload += "\"latitude\":" + String(lat, 6) + ",";
    payload += "\"longitude\":" + String(lon, 6) + ",";
    payload += "\"gpsLock\":" + String(hasGpsLock ? "true" : "false") + ",";
    
    // Cryptographic Signature Generation
    String rawData = String(DEVICE_SECRET) + sensorHardwareId + String(unixTimestamp) + String(temp, 1);
    
    SHA256 hash;
    uint8_t result[32];
    hash.reset();
    hash.update(rawData.c_str(), rawData.length());
    hash.finalize(result, sizeof(result));
    
    String sig = "0x";
    for(int i = 0; i < 32; i++) {
      if(result[i] < 16) sig += "0";
      sig += String(result[i], HEX);
    }
    
    payload += "\"signature\": \"" + sig + "\"";

    payload += "}";

    Serial.print("Publishing message: ");
    Serial.println(payload);
    
    client.publish("logitrust/telemetry/yashas", payload.c_str());
  }
}
