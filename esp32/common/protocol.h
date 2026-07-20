/**
 * 城市公园环境多点监测系统 — 通信协议定义
 *
 * 同时用于中心节点 & 子节点，保持两端数据结构一致。
 * 增强版：子节点通过边缘计算引擎在本地完成数据处理后上报。
 *
 * 本文件完全自包含 — 无需额外的 .cpp 实现文件。
 */

#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <stdint.h>
#include <string.h>

#pragma pack(1)

typedef struct {
    uint8_t  node_id;
    uint8_t  zone_id;
    float    temperature;
    float    humidity;
    uint16_t dust_level;
    uint16_t dust_peak;
    float    heat_index;
    float    dew_point;
    uint16_t aqi;
    uint8_t  anomaly_flags;
    uint8_t  data_quality;
    uint32_t timestamp;
    uint8_t  battery;
    uint16_t crc;
} sensor_data_t;

typedef struct {
    uint8_t command;
    uint8_t target_node;
} poll_request_t;

typedef struct {
    uint8_t  node_id;
    uint8_t  status;
    uint8_t  battery;
    uint32_t uptime;
} heartbeat_resp_t;

#pragma pack()

#define CMD_DATA_REQ   0x01
#define CMD_HEARTBEAT  0x02

#define ANOMALY_NONE        0x00
#define ANOMALY_TEMP_HIGH   0x01
#define ANOMALY_TEMP_LOW    0x02
#define ANOMALY_HUM_HIGH    0x04
#define ANOMALY_DUST_HIGH   0x08
#define ANOMALY_SENSOR_ERR  0x10
#define ANOMALY_SUDDEN_CHG  0x20

#define MAX_NODES      4

#define DUST_EXCELLENT      35
#define DUST_GOOD           75
#define DUST_LIGHT_POLLUTE  115
#define DUST_MODERATE_POLLUTE 150
#define DUST_HEAVY_POLLUTE  250

enum AlertLevel { NORMAL = 0, WARNING, DANGER, CRITICAL };

static const char* ZONE_NAMES[] = {
    "",
    "入口广场",
    "健身活动区",
    "湖区周边",
    "林荫步道"
};

static inline uint16_t calc_crc16(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++) {
            if (crc & 1)
                crc = (crc >> 1) ^ 0xA001;
            else
                crc >>= 1;
        }
    }
    return crc;
}

static inline uint16_t gp2y_calc_dust(float vo, float vcc = 5.0f) {
    if (vo < 0.0f) vo = 0.0f;
    float dust_mg = (vo * 10.0f / vcc - 0.6f) / 0.172f;
    if (dust_mg < 0.0f) dust_mg = 0.0f;
    return (uint16_t)(dust_mg * 1000.0f);
}

static inline AlertLevel gp2y_dust_level(uint16_t dust_ug) {
    if (dust_ug <= DUST_EXCELLENT)       return NORMAL;
    if (dust_ug <= DUST_GOOD)            return WARNING;
    if (dust_ug <= DUST_LIGHT_POLLUTE)   return DANGER;
    return CRITICAL;
}

static inline uint16_t gp2y_dust_color(uint16_t dust_ug) {
    AlertLevel lv = gp2y_dust_level(dust_ug);
    switch (lv) {
        case NORMAL:   return 0x07E0;
        case WARNING:  return 0xFFE0;
        case DANGER:   return 0xFDA0;
        case CRITICAL: return 0xF800;
        default:       return 0x07E0;
    }
}

#endif /* PROTOCOL_H */
