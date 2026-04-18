// ===== Libraries =====
#include <DallasTemperature.h>
#include <OneWire.h>

// ===== Pins =====
const int pulsePin  = A0;
const int blinkPin  = 13;
const int greenLED  = 7;
const int yellowLED = 6;
const int blueLED   = 5;
const int buzzerPin = 2;

// ===== DS18B20 Temperature Sensor =====
const int DS18B20_PIN = 4;
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);

// ----- Temperature variables -----
float currentTemp = 0.0f;
unsigned long lastTempRead    = 0;
const unsigned long TEMP_INTERVAL = 2000;
bool tempSensorFound  = false;
bool tempRequested    = false;
unsigned long tempRequestTime = 0;

// ----- Pause -----
volatile boolean paused = false;
boolean bpmPaused  = false;   // independent BPM pause
boolean tempPaused = false;   // independent Temp pause

// ----- PulseSensor variables -----
volatile int  Signal = 512;
volatile int  BPM    = 0;
volatile int  IBI    = 600;
volatile bool Pulse  = false;
volatile bool QS     = false;
volatile bool noSignalFlag = false;
volatile int  rate[10];
volatile unsigned long sampleCounter = 0;
volatile unsigned long lastBeatTime  = 0;
volatile int  P      = 512;
volatile int  T      = 512;
volatile int  thresh = 512;
volatile int  amp    = 100;
volatile bool firstBeat  = true;
volatile bool secondBeat = false;

// ----- Buzzer -----
unsigned long buzzerStartTime = 0;
const unsigned long buzzerDuration = 100;
int  buzzerRemaining = 0;
bool buzzerOn = false;

// ----- BPM smoothing -----
float bpmSmooth = 0.0f;
bool  bpmFirstReading = true;
int   beatCount    = 0;
const int SKIP_BEATS = 8;       // skip more unstable initial beats (was 5)
int   validReadings = 0;

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  Serial.setTimeout(10);   // FIX: قلّلنا timeout لتقليل blocking في loop()

  pinMode(blinkPin,  OUTPUT);
  pinMode(greenLED,  OUTPUT);
  pinMode(yellowLED, OUTPUT);
  pinMode(blueLED,   OUTPUT);
  pinMode(buzzerPin, OUTPUT);

  digitalWrite(greenLED,  LOW);
  digitalWrite(yellowLED, LOW);
  digitalWrite(blueLED,   LOW);
  digitalWrite(buzzerPin, LOW);

  analogReference(DEFAULT);

  // ---- DS18B20 Init ----
  // FIX: بدون noInterrupts — OneWire تدير توقيتها بنفسها
  tempSensor.begin();
  tempSensorFound = (tempSensor.getDeviceCount() > 0);
  if (tempSensorFound) {
    tempSensor.setResolution(12);
    tempSensor.setWaitForConversion(false); // non-blocking
  } else {
    Serial.println("STATUS:NO_TEMP_SENSOR");
  }

  Serial.println("STATUS:CALIBRATING");

  // FIX: Calibration — نستخدم المتوسط فعلاً كنقطة بداية
  long sum = 0;
  for (int i = 0; i < 100; i++) {
    sum += analogRead(pulsePin);
    delay(10);
  }
  int baseline = (int)(sum / 100);
  thresh = baseline;
  P = baseline;
  T = baseline;

  interruptSetup();
  Serial.println("STATUS:READY");
}

// ===== LOOP =====
void loop() {

  // ---- Serial Commands ----
  if (Serial.available() > 0) {
    char cmdBuf[16];
    int len = Serial.readBytesUntil('\n', cmdBuf, sizeof(cmdBuf) - 1);
    cmdBuf[len] = '\0';
    if (len > 0 && cmdBuf[len - 1] == '\r')
      cmdBuf[len - 1] = '\0';

    if (strcmp(cmdBuf, "PAUSE") == 0) {
      paused = true;
      digitalWrite(greenLED,  LOW);
      digitalWrite(yellowLED, LOW);
      digitalWrite(blueLED,   LOW);
      digitalWrite(buzzerPin, LOW);
      Serial.println("STATUS:PAUSED");

    } else if (strcmp(cmdBuf, "RESUME") == 0) {
      noInterrupts();
      firstBeat  = true;
      secondBeat = false;
      thresh = 512; P = 512; T = 512;
      interrupts();

      paused          = false;
      bpmPaused       = false;
      tempPaused      = false;
      bpmFirstReading = true;
      beatCount       = 0;
      validReadings   = 0;
      Serial.println("STATUS:RESUMED");

    } else if (strcmp(cmdBuf, "RESET") == 0) {
      noInterrupts();
      firstBeat    = true;
      secondBeat   = false;
      Pulse        = false;
      QS           = false;
      noSignalFlag = false;
      BPM          = 0;
      IBI          = 600;
      amp          = 100;
      thresh       = 512;
      P            = 512;
      T            = 512;
      sampleCounter  = 0;
      lastBeatTime   = 0;
      for (int i = 0; i < 10; i++) rate[i] = 0;
      interrupts();

      paused          = false;
      bpmPaused       = false;
      tempPaused      = false;
      bpmFirstReading = true;
      beatCount       = 0;
      validReadings   = 0;
      bpmSmooth       = 0.0f;

      digitalWrite(greenLED,  LOW);
      digitalWrite(yellowLED, LOW);
      digitalWrite(blueLED,   LOW);
      digitalWrite(buzzerPin, LOW);
      buzzerRemaining = 0;
      buzzerOn        = false;

      currentTemp   = 0.0f;
      lastTempRead  = 0;
      tempRequested = false;

      Serial.println("STATUS:RESET");

    // ── Per-sensor pause/resume ──
    } else if (strcmp(cmdBuf, "PAUSE_BPM") == 0) {
      bpmPaused = true;
      Serial.println("STATUS:BPM_PAUSED");

    } else if (strcmp(cmdBuf, "RESUME_BPM") == 0) {
      bpmPaused = false;
      noInterrupts();
      firstBeat  = true;
      secondBeat = false;
      thresh = 512; P = 512; T = 512;
      interrupts();
      bpmFirstReading = true;
      beatCount       = 0;
      validReadings   = 0;
      Serial.println("STATUS:BPM_RESUMED");

    } else if (strcmp(cmdBuf, "PAUSE_TEMP") == 0) {
      tempPaused = true;
      Serial.println("STATUS:TEMP_PAUSED");

    } else if (strcmp(cmdBuf, "RESUME_TEMP") == 0) {
      tempPaused = false;
      Serial.println("STATUS:TEMP_RESUMED");
    }
  }

  // ---- DS18B20 Hot-plug Detection ----
  if (!tempSensorFound) {
    static unsigned long lastSearch = 0;
    unsigned long now = millis();
    if (now - lastSearch > 5000) {
      lastSearch = now;
      // FIX: بدون noInterrupts — OneWire تدير توقيتها بنفسها
      tempSensor.begin();
      if (tempSensor.getDeviceCount() > 0) {
        tempSensorFound = true;
        tempSensor.setResolution(12);
        tempSensor.setWaitForConversion(false);
        Serial.println("STATUS:TEMP_SENSOR_FOUND");
      } else {
        Serial.println("STATUS:NO_TEMP_SENSOR");
      }
    }
  }

  // ---- DS18B20 Temperature Reading ----
  if (tempSensorFound && !paused && !tempPaused) {
    unsigned long now = millis();

    // 1. Request conversion
    if (!tempRequested && (now - lastTempRead >= TEMP_INTERVAL)) {
      // FIX: بدون noInterrupts — OneWire تدير توقيتها بنفسها
      tempSensor.requestTemperatures();
      tempRequested   = true;
      tempRequestTime = now;
    }

    // 2. Read after 750ms (12-bit conversion time)
    if (tempRequested && (now - tempRequestTime >= 750)) {
      float t = tempSensor.getTempCByIndex(0);
      if (t != DEVICE_DISCONNECTED_C && t > -50.0 && t < 125.0) {
        currentTemp = t;
        Serial.print("TEMP:");
        Serial.println(currentTemp, 1);
      } else {
        Serial.println("STATUS:NO_TEMP_SENSOR");
        tempSensorFound = false; // Trigger the search logic again
      }
      tempRequested = false;
      lastTempRead  = now;
    }
  }

  // ---- Safe read from ISR ----
  bool localQS       = false;
  int  localBPM      = 0;
  bool localNoSignal = false;

  noInterrupts();
  if (QS) {
    localQS  = true;
    localBPM = BPM;
    QS       = false;
  }
  if (noSignalFlag) {
    localNoSignal = true;
    noSignalFlag  = false;
  }
  interrupts();

  if (!paused) {

    handleBuzzer();

    if (localQS) {
      beatCount++;

      if (beatCount > SKIP_BEATS && localBPM >= 30 && localBPM <= 200 && !bpmPaused) {
        validReadings++;

        int safeBPM = localBPM;

        // Clamp first 5 valid readings to 100 BPM max (prevents startup spikes)
        if (validReadings <= 5 && safeBPM > 100) safeBPM = 100;

        // Hard cap at 180 BPM — safety net against runaway
        if (safeBPM > 180) safeBPM = 180;

        if (bpmFirstReading) {
          bpmSmooth       = (float)safeBPM;
          bpmFirstReading = false;
        } else {
          int   diff = abs(safeBPM - (int)bpmSmooth);
          float weight;
          if      (validReadings <= 8) weight = 0.10f;  // warm-up: very slow
          else if (diff > 25)          weight = 0.03f;  // big outlier: nearly ignore
          else if (diff > 12)          weight = 0.10f;  // moderate change: cautious
          else                         weight = 0.20f;  // normal: standard update

          bpmSmooth = (1.0f - weight) * bpmSmooth + weight * (float)safeBPM;
        }

        int bpmOut = (int)(bpmSmooth + 0.5f);
        sendBPM(bpmOut);
      }
    }

    if (localNoSignal) {
      Serial.println("STATUS:NO_SIGNAL");
      digitalWrite(greenLED, LOW);
      digitalWrite(blueLED,  LOW);
    }
  }
}

// ===== SEND BPM =====
void sendBPM(int currentBPM) {
  Serial.print("BPM:");
  Serial.println(currentBPM);

  if (currentBPM < 60) {
    Serial.println("STATUS:SLOW");
    digitalWrite(greenLED, LOW);
    digitalWrite(blueLED,  LOW);
    triggerBuzzer(1);
  } else if (currentBPM <= 100) {
    Serial.println("STATUS:NORMAL");
    digitalWrite(greenLED, HIGH);
    digitalWrite(blueLED,  LOW);
  } else {
    Serial.println("STATUS:HIGH");
    digitalWrite(greenLED, LOW);
    digitalWrite(blueLED,  HIGH);
    triggerBuzzer(2);
  }
}

// ===== BUZZER =====
void triggerBuzzer(int times) {
  if (buzzerRemaining == 0 && times > 0) {
    buzzerRemaining = times;
    buzzerOn        = true;
    digitalWrite(buzzerPin, HIGH);
    buzzerStartTime = millis();
  }
}

void handleBuzzer() {
  if (buzzerRemaining <= 0) return;

  unsigned long now = millis();

  if (buzzerOn && (now - buzzerStartTime >= buzzerDuration)) {
    digitalWrite(buzzerPin, LOW);
    buzzerOn = false;
    buzzerRemaining--;
    buzzerStartTime = now;
  } else if (!buzzerOn && buzzerRemaining > 0 &&
             (now - buzzerStartTime >= buzzerDuration)) {
    digitalWrite(buzzerPin, HIGH);
    buzzerOn        = true;
    buzzerStartTime = now;
  }
}

// ===== TIMER SETUP =====
void interruptSetup() {
  TCCR2A = 0x02;
  TCCR2B = 0x06;
  OCR2A  = 0x7C;
  TIMSK2 = 0x02;
}

// ===== ISR =====
ISR(TIMER2_COMPA_vect) {

  if (paused) return;

  // FIX: رجّعنا analogRead للـ ISR — الطريقة الأصلية الأفضل عملياً
  // (بديلها signalBuffer كان بيوقف الـ ISR أثناء OneWire)
  Signal = analogRead(pulsePin);

  sampleCounter += 2;
  int N = (int)(sampleCounter - lastBeatTime);

  // ---- Find trough T ----
  if (Signal < thresh && N > (IBI / 5) * 3) {
    if (Signal < T) T = Signal;
  }

  // ---- Find peak P ----
  if (Signal > thresh && Signal > P) {
    P = Signal;
  }

  // ---- Beat detection ----
  // Use LIVE amplitude (P - T) instead of stale amp for beat validation
  // This prevents false beats when finger is removed (stale amp was high)
  int liveAmp = P - T;

  // 500ms minimum refractory = max 120 BPM (for resting heart rate monitor)
  if (N > 500) {
    int minRefractory = (IBI / 5) * 3;
    if (minRefractory < 500) minRefractory = 500;

    if (Signal > thresh && !Pulse && N > minRefractory && liveAmp > 80) {

      Pulse = true;
      PORTB |= (1 << PB5);   // blinkPin  (pin 13) HIGH
      PORTD |= (1 << PD6);   // yellowLED (pin 6)  HIGH

      IBI = (int)(sampleCounter - lastBeatTime);
      lastBeatTime = sampleCounter;

      if (secondBeat) {
        secondBeat = false;
        for (int i = 0; i <= 9; i++) rate[i] = IBI;
      }

      if (firstBeat) {
        firstBeat  = false;
        secondBeat = true;
        return;
      }

      unsigned long runningTotal = 0;
      for (int i = 0; i <= 8; i++) {
        rate[i] = rate[i + 1];
        runningTotal += rate[i];
      }
      rate[9] = IBI;
      runningTotal += rate[9];
      runningTotal /= 10;
      BPM = (int)(60000UL / runningTotal);
      QS  = true;
    }
  }

  // ---- Reset after beat ----
  if (Signal < thresh && Pulse) {
    PORTB &= ~(1 << PB5);   // blinkPin  LOW
    PORTD &= ~(1 << PD6);   // yellowLED LOW
    Pulse = false;

    amp    = P - T;
    thresh = amp / 2 + T;

    // Constrain threshold to valid ADC range
    if (thresh < 150) thresh = 150;
    if (thresh > 900) thresh = 900;

    P = thresh;
    T = thresh;
  }

  // ---- Decay amp when idle ----
  // If no beat for 1.5s, start decaying amp so stale values can't trigger beats
  if (N > 1500 && amp > 0) {
    amp -= 2;
    if (amp < 0) amp = 0;
  }

  // ---- No signal timeout ----
  // Reduced from 2500ms to 1800ms for faster finger-off detection
  if (N > 1800) {
    thresh       = 512;
    P            = 512;
    T            = 512;
    amp          = 0;
    lastBeatTime = sampleCounter;
    firstBeat    = true;
    secondBeat   = false;
    noSignalFlag = true;
  }
}
//x606