# 生产成本对账

状态：生产 Docker rollout 前待执行。

## 需要采集

- system/custom 分别统计成功率、relay 耗时、失败率、队列等待、worker CPU/内存、Neon 连接与查询、对象存储容量/egress。
- system 再统计每张收入、relay 成本、数据库/存储和 Docker 主机分摊，确认有效毛利为正。
- custom 的本站积分收入为零；仍需量化主机、数据库和存储消耗，作为人工容量决策依据。

## 上线后执行

- 完成受控 system/custom 样本与一周观察。
- 记录 p50/p95、成功率、成本和告警阈值。
- 根据实测设置 system 日预算与 worker 并发；不要自动把 custom 流量回退到 system。
- 确认备份、告警和容量计划后再提高生成量。

历史 GB-hour/Netlify 计算模型已退役；当前模型以 Docker 主机、relay、数据库和存储为准。
