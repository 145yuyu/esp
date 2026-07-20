// ST7735 128x128 TFT 配置文件 - ESP32-S3
// 接线: SCL=18, SDA=17, RES=21, DC=4, CS=5, BL=3.3V

#define USER_SETUP_ID 99

// ===== 驱动类型 =====
#define ST7735_DRIVER

// ===== 显示尺寸 =====
#define TFT_WIDTH  128
#define TFT_HEIGHT 128

// ===== ST7735 面板类型（只定义一个）=====
#define ST7735_GREENTAB128     // 128x128 常用

// ===== 颜色参数 =====
// 如果颜色不对（红蓝颠倒、黑白反转），取消下面其中一行的注释
// #define TFT_RGB_ORDER TFT_RGB
// #define TFT_RGB_ORDER TFT_BGR
// #define TFT_INVERSION_ON
// #define TFT_INVERSION_OFF

// ===== ESP32-S3 引脚定义 =====
#define TFT_MOSI 17
#define TFT_SCLK 18
#define TFT_CS   5
#define TFT_DC   4
#define TFT_RST  21

#define TFT_MISO -1   // 不读取 TFT，设为 -1
#define TFT_BL   -1   // 背光直接接 3.3V

// ===== SPI 频率 =====
#define SPI_FREQUENCY  27000000
#define SPI_READ_FREQUENCY  16000000

// ===== 字体 =====
#define LOAD_GLCD
#define LOAD_FONT2
#define LOAD_FONT4
#define LOAD_FONT6
#define LOAD_FONT7
#define LOAD_FONT8
#define LOAD_GFXFF
#define SMOOTH_FONT
