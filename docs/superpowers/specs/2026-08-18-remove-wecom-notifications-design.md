# 移除企业微信通知设计

## 目标

从项目中彻底移除企业微信机器人通知能力，同时保留盘中雷达数据刷新、集合竞价快照和预警计算。

## 删除范围

- 删除企业微信发送封装 `scripts/notify_wecom.py`。
- 删除盘中雷达消息拼装脚本 `scripts/notify_intraday_radar.py`。
- 从 `scripts/intraday_radar_daemon.py` 删除通知调度、节流状态、命令行参数和日志。
- 从 `scripts/auction_probe.py` 删除通知导入、发送函数、webhook 参数和通知开关。
- 删除 README 和测试中与企业微信、webhook 及通知脚本有关的内容。

## 保留范围

- 盘中雷达的数据构建和定时刷新。
- 集合竞价探针的数据抓取、快照保存、预警计算和单次运行能力。
- `.env` 文件及其中与其他功能有关的配置。

## 验收标准

- 项目代码和文档不再引用 `WECOM_WEBHOOK_URL`、`WeComNotifier`、`notify_wecom` 或 `notify_intraday_radar`。
- 两个通知脚本已删除。
- 盘中雷达守护进程和集合竞价探针仍能通过语法检查及相关测试。
