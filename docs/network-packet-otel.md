# 网络报文 OTel 方案

CX Viewer 使用 **OpenTelemetry Collector** 作为唯一的网络报文追踪方案。

## 架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Codex CLI  │────▶│   cx-viewer │────▶│ OTel        │
│  (fetch)    │     │ interceptor │     │ Collector   │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                   ┌───────────┐        ┌───────────┐      ┌───────────┐
                   │  Jaeger   │        │  Grafana  │      │  Custom   │
                   │    UI     │        │   Tempo   │      │  Backend  │
                   └───────────┘        └───────────┘      └───────────┘
```

## 配置

### 1. 环境变量

```bash
# 启用/禁用 OTel（默认开启）
export CXV_OTEL_ENABLED=1

# OTel Collector 端点
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# 跳过心跳请求（减少数据量）
export CXV_OTEL_SKIP_HEARTBEAT=1
```

### 2. 启动 Collector

```bash
# Development mode
docker run -p 4318:4318 otel/opentelemetry-collector:latest

# With Jaeger UI
docker run -p 16686:16686 -p 14250:14250 jaegertracing/all-in-one:latest
```

## 数据模型

### Span 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `http.request.method` | string | HTTP 方法 |
| `http.request.url` | string | 完整 URL |
| `http.request.headers` | string | Headers (JSON) |
| `http.request.body.size` | int | 请求体大小 |
| `http.response.status_code` | int | HTTP 状态码 |
| `http.response.headers` | string | 响应 Headers |
| `http.response.body.size` | int | 响应体大小 |
| `http.request.duration_ms` | int | 请求耗时 |
| `cx.codex.main_agent` | boolean | 是否主代理请求 |
| `cx.codex.is_stream` | boolean | 是否流式请求 |
| `cx.codex.model` | string | 模型名称 |
| `cx.codex.message_count` | int | 消息数量 |
| `cx.codex.usage.input_tokens` | int | 输入 Token |
| `cx.codex.usage.output_tokens` | int | 输出 Token |

## 前端集成

前端通过查询 OTel 后端（如 Jaeger Query API）获取网络报文数据。

### 示例：查询 Jaeger

```javascript
// 获取当前会话的 Traces
const traces = await fetch(
  `http://localhost:16686/api/traces?service=cx-viewer&tag=cx-viewer.session=${sessionId}`
);
```

## 故障排查

```bash
# 检查 OTel 是否工作
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[]}'

# 查看 Jaeger Traces
open http://localhost:16686
```
