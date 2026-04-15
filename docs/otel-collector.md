# OpenTelemetry Collector 集成方案

CX Viewer 现已支持 OpenTelemetry Collector 集成，用于网络报文模式的追踪和展示。

## 功能特性

- **自动追踪所有 Codex API 请求**：拦截并导出所有网络请求为 OTel Traces
- **完整报文信息**：包含请求/响应 Headers、Body、状态码、耗时等
- **多语言支持**：支持 Jaeger、Zipkin、Prometheus 等多种后端
- **本地日志保留**：同时保留本地 JSONL 日志文件供前端展示

## 快速开始

### 1. 启动 OTel Collector

使用 Docker 启动简单的 Collector（开发环境）：

```bash
docker run -p 4318:4318 \
  -e OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT=0.0.0.0:4318 \
  otel/opentelemetry-collector:latest
```

或使用完整配置的 Collector：

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:

exporters:
  jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true
  logging:
    loglevel: debug

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [jaeger, logging]
```

### 2. 配置 CX Viewer

环境变量方式：

```bash
# 启用 OTel 导出（默认开启）
export CXV_OTEL_ENABLED=1

# 配置 Collector 地址
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# 禁用本地日志文件（可选）
# export CXV_OTEL_LOCAL_FILE=0

# 跳过心跳请求（减少数据量）
# export CXV_OTEL_SKIP_HEARTBEAT=1
```

### 3. 使用 cx-viewer

```bash
# 正常使用 cxv
npx cxv

# 或通过环境变量启用 OTel
cxv
```

## 配置选项

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `CXV_OTEL_ENABLED` | `1` | 启用 OTel 追踪导出 |
| `CXV_OTEL_LOCAL_FILE` | `1` | 同时保存到本地网络报文日志 |
| `CXV_OTEL_SKIP_HEARTBEAT` | `0` | 跳过心跳/计数 token 请求 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP HTTP 端点 |

## 数据结构

### Trace Attributes

每个网络请求会生成一个 Span，包含以下属性：

```javascript
{
  // HTTP 标准属性
  'http.request.method': 'POST',
  'http.request.url': 'https://api.anthropic.com/v1/messages',
  'http.request.headers': '{...}',
  'http.request.body.size': 1234,
  'http.response.status_code': 200,
  'http.response.body.size': 5678,
  'http.request.duration_ms': 2500,

  // Codex 特定属性
  'cx.codex.main_agent': true,
  'cx.codex.is_stream': true,
  'cx.codex.model': 'claude-opus-4',
  'cx.codex.message_count': 10,
  'cx.codex.tool_count': 5,
  'cx.codex.usage.input_tokens': 1500,
  'cx.codex.usage.output_tokens': 2500,
}
```

### 本地日志文件

网络报文同时保存在独立的 JSONL 文件中：

```
~/.cc-viewer/logs/{project}/network-packets-{timestamp}.jsonl
```

格式示例：

```json
{"type":"request","traceId":"...","spanId":"...","timestamp":"...","requestEntry":{...}}
---
{"type":"response","traceId":"...","spanId":"...","timestamp":"...","duration":2500,"response":{...}}
---
```

## 与后端集成

### Jaeger UI

查看完整的请求追踪时间线：

```bash
docker run -p 16686:16686 -p 14250:14250 jaegertracing/all-in-one:latest
```

访问 http://localhost:16686 查看 Traces

### Grafana Tempo

配置 Grafana 数据源指向 Tempo，即可在 Grafana 中查询和展示网络报文追踪。

### 自定义处理

通过 OTel Collector 的 processor 可以：

- 过滤特定类型的请求
- 脱敏敏感信息
- 添加自定义标签
- 路由到不同的后端

## 前端网络报文视图

CX Viewer 前端提供专门的网络报文展示界面：

- **列表视图**：所有网络请求的摘要信息
- **详情视图**：请求/响应的完整 Headers 和 Body
- **时间线视图**：请求-响应的时间轴展示
- **过滤功能**：按类型、状态码、模型等过滤

## 故障排查

### 检查 OTel 是否工作

```bash
# 检查环境变量
env | grep OTEL

# 查看网络报文日志文件是否生成
ls ~/.cc-viewer/logs/*/network-packets-*.jsonl
```

### 常见问题

**Q: 没有 Traces 发送到 Collector**

检查：
1. Collector 是否运行在正确端口
2. `OTEL_EXPORTER_OTLP_ENDPOINT` 是否配置正确
3. `CXV_OTEL_ENABLED` 是否为 1

**Q: 本地网络报文文件为空**

检查：
1. 是否有 HTTP 请求被拦截
2. `CXV_OTEL_LOCAL_FILE` 是否为 1

**Q: 如何忽略特定请求**

设置 `CXV_OTEL_SKIP_HEARTBEAT=1` 可跳过心跳和 token 计数请求。

## 性能考虑

- OTel Traces 是异步导出的，对主流程影响极小
- 本地日志文件使用追加写入，避免频繁文件操作
- 可通过过滤减少发送到 Collector 的数据量

## 安全注意事项

- Headers 中的敏感信息（Authorization、API Key）会自动脱敏
- 默认只发送前 1000 字节的响应 Body 到 OTel
- 如需更严格的安全策略，可在 Collector 端配置 processor 进行额外过滤
