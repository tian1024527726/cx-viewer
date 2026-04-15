# 网络报文视图集成指南

本文档说明如何将 NetworkPacketView 组件集成到 CX Viewer 主应用中。

## 基础集成

### 1. 在 AppBase.jsx 中添加状态

```javascript
// 在 constructor 中添加
this.state = {
  // ... 其他状态
  networkPackets: [],        // 网络报文数据
  showNetworkView: false,    // 是否显示网络报文视图
  networkViewMode: 'list',   // 'list' | 'timeline'
}
```

### 2. 添加网络报文数据接收

在 SSE 事件处理中添加网络报文类型的事件监听：

```javascript
// 在 SSE 消息处理中
if (data.type === 'network_packet') {
  this.addNetworkPacket(data.packet);
}
```

### 3. 实现数据添加方法

```javascript
addNetworkPacket(packet) {
  this.setState(prev => ({
    networkPackets: [...prev.networkPackets, packet]
  }));
}
```

### 4. 在渲染中添加视图切换

```javascript
import NetworkPacketView from './components/NetworkPacketView';

// 在 render 方法中
{this.state.showNetworkView ? (
  <NetworkPacketView packets={this.state.networkPackets} />
) : (
  // ... 原有视图
)}
```

## 服务端支持

需要修改 `server.js` 添加网络报文数据的 SSE 推送：

```javascript
// 读取网络报文日志文件并推送
function streamNetworkPackets(logFile, clients) {
  // 监听 network-packets-*.jsonl 文件
  // 推送事件到前端
}
```

## API 端点

添加新的 API 端点获取网络报文：

```javascript
// GET /api/network-packets?project={project}&file={filename}
app.get('/api/network-packets', (req, res) => {
  const { project, file } = req.query;
  // 读取并返回网络报文数据
  const packets = readNetworkPackets(project, file);
  res.json({ packets });
});
```

## 视图切换 UI

在 Header 或工具栏中添加切换按钮：

```jsx
<Button
  icon={<GlobalOutlined />}
  onClick={() => this.setState({ showNetworkView: !showNetworkView })}
>
  {t('network.title')}
</Button>
```

## 完整示例

### AppBase.jsx 修改

```javascript
class AppBase extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      // ... existing states
      networkPackets: [],
      currentView: 'chat', // 'chat' | 'network'
    };
  }

  // 接收网络报文数据
  handleNetworkPacket = (packet) => {
    this.setState(prev => ({
      networkPackets: [...prev.networkPackets, packet]
    }));
  }

  // 清空网络报文
  clearNetworkPackets = () => {
    this.setState({ networkPackets: [] });
  }

  render() {
    const { currentView, networkPackets } = this.state;

    return (
      <div className={styles.app}>
        <AppHeader
          currentView={currentView}
          onViewChange={(view) => this.setState({ currentView: view })}
        />

        {currentView === 'chat' ? (
          <ChatView {...chatProps} />
        ) : (
          <NetworkPacketView
            packets={networkPackets}
            onClear={this.clearNetworkPackets}
          />
        )}
      </div>
    );
  }
}
```

### AppHeader.jsx 修改

```javascript
// 添加视图切换按钮
<Segmented
  options={[
    { label: t('view.chat'), value: 'chat', icon: <MessageOutlined /> },
    { label: t('view.network'), value: 'network', icon: <GlobalOutlined /> },
  ]}
  value={currentView}
  onChange={onViewChange}
/>
```

## 进阶功能

### 实时追踪

使用 WebSocket 替代轮询获取实时网络报文：

```javascript
// 在 NetworkPacketView 组件中
useEffect(() => {
  const ws = new WebSocket('ws://localhost:3000/ws/network');
  ws.onmessage = (event) => {
    const packet = JSON.parse(event.data);
    addPacket(packet);
  };
  return () => ws.close();
}, []);
```

### 报文导出

添加导出功能：

```javascript
function exportPackets(packets, format = 'json') {
  if (format === 'har') {
    // 导出为 HAR 格式（Chrome DevTools 兼容）
    const har = convertToHAR(packets);
    downloadJSON(har, 'network.har');
  } else if (format === 'curl') {
    // 导出为 cURL 命令
    const curls = packets.map(p => convertToCurl(p));
    downloadText(curls.join('\n\n'), 'requests.sh');
  }
}
```

### 报文比较

选择两个报文进行比较：

```javascript
function comparePackets(packet1, packet2) {
  const diff = {
    url: packet1.url === packet2.url ? 'same' : 'different',
    headers: compareHeaders(packet1.headers, packet2.headers),
    body: compareJSON(packet1.body, packet2.body),
  };
  return diff;
}
```

## 性能优化

### 虚拟滚动

大量报文时使用虚拟滚动：

```javascript
import { Virtuoso } from 'react-virtuoso';

<Virtuoso
  data={packets}
  itemContent={(index, packet) => (
    <PacketRow packet={packet} />
  )}
/>
```

### 增量加载

实现分页或滚动加载：

```javascript
function loadMorePackets(before) {
  fetch(`/api/network-packets?before=${before}&limit=50`)
    .then(res => res.json())
    .then(data => {
      setPackets(prev => [...prev, ...data.packets]);
    });
}
```

## 样式定制

通过 CSS 变量自定义主题：

```css
:root {
  --network-request-color: #1890ff;
  --network-response-color: #52c41a;
  --network-error-color: #ff4d4f;
  --network-pending-color: #faad14;
}
```

## 测试

使用 mock 数据测试组件：

```javascript
const mockPackets = [
  {
    traceId: 'abc123',
    timestamp: '2024-01-01T00:00:00Z',
    requestEntry: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      headers: { ... },
      body: { model: 'claude-opus-4', ... },
      response: { status: 200, body: { ... } },
      duration: 2500,
      mainAgent: true,
    }
  },
  // ... more packets
];

// 在 Storybook 或测试中
<NetworkPacketView packets={mockPackets} />
```
