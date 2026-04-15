/**
 * NetworkPacketView - 网络报文展示组件
 * 展示通过 OTel 追踪的所有 Codex 网络请求/响应详情
 */

import React, { useState, useMemo } from 'react';
import { Tabs, Tag, Table, Collapse, Typography, Select, Input, Space, Badge, Tooltip, Timeline, Card } from 'antd';
import { ArrowRightOutlined, ClockCircleOutlined, SwapRightOutlined, FilterOutlined } from '@ant-design/icons';
import JsonViewer from './JsonViewer';
import { t } from '../i18n';
import styles from './NetworkPacketView.module.css';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;
const { Option } = Select;

/**
 * 格式化 Header 显示
 */
const formatHeaders = (headers) => {
  if (!headers) return {};
  const result = {};
  Object.entries(headers).forEach(([key, value]) => {
    result[key] = value;
  });
  return result;
};

/**
 * 提取关键请求信息
 */
const extractKeyInfo = (packet) => {
  const entry = packet.requestEntry || packet;
  const body = entry.body || {};
  const response = entry.response?.body || {};

  return {
    model: body.model || response.model || '-',
    messageCount: body.messages?.length || 0,
    toolCount: body.tools?.length || 0,
    tokenInput: entry.response?.body?.usage?.input_tokens || 0,
    tokenOutput: entry.response?.body?.usage?.output_tokens || 0,
    duration: entry.duration || 0,
    isStream: entry.isStream || body.stream === true,
    mainAgent: entry.mainAgent || false,
    teammate: entry.teammate,
    teamName: entry.teamName,
  };
};

/**
 * 状态码颜色
 */
const getStatusColor = (status) => {
  if (!status) return 'gray';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'warning';
  if (status >= 400) return 'error';
  return 'default';
};

/**
 * 单行报文摘要
 */
const PacketSummary = ({ packet }) => {
  const entry = packet.requestEntry || packet;
  const info = extractKeyInfo(packet);
  const status = entry.response?.status;

  return (
    <div className={styles.packetSummary}>
      <Space size="small" wrap>
        <Badge
          status={entry.response ? 'success' : 'processing'}
          text={entry.method || 'GET'}
        />
        <Text className={styles.url} ellipsis style={{ maxWidth: 300 }}>
          {entry.url || '-'}
        </Text>
        <Tag color={getStatusColor(status)}>{status || 'pending'}</Tag>
        {info.duration > 0 && (
          <Tag icon={<ClockCircleOutlined />} color="blue">
            {info.duration}ms
          </Tag>
        )}
        {info.mainAgent && <Tag color="purple">{t('network.main_agent')}</Tag>}
        {info.teammate && (
          <Tag color="cyan">
            {t('network.teammate')}: {info.teammate}
          </Tag>
        )}
        {info.isStream && <Tag color="geekblue">{t('network.stream')}</Tag>}
        {info.model && info.model !== '-' && (
          <Tag color="gold">{info.model}</Tag>
        )}
        {info.tokenInput + info.tokenOutput > 0 && (
          <Tag color="volcano">
            {info.messageCount > 0 && `${info.messageCount} msgs · `}
            {info.tokenOutput + info.tokenInput} tokens
          </Tag>
        )}
      </Space>
    </div>
  );
};

/**
 * 报文详情面板
 */
const PacketDetail = ({ packet }) => {
  const entry = packet.requestEntry || packet;
  const [activeTab, setActiveTab] = useState('request');

  const requestItems = [
    { label: t('network.tab_headers'), key: 'headers', children: (
      <JsonViewer
        data={formatHeaders(entry.headers)}
        name="headers"
        collapsed={1}
      />
    )},
    { label: t('network.tab_body'), key: 'body', children: (
      <JsonViewer
        data={entry.body || {}}
        name="body"
        collapsed={2}
      />
    )},
  ];

  const responseItems = entry.response ? [
    { label: t('network.tab_headers'), key: 'headers', children: (
      <JsonViewer
        data={formatHeaders(entry.response.headers)}
        name="headers"
        collapsed={1}
      />
    )},
    { label: t('network.tab_body'), key: 'body', children: (
      <JsonViewer
        data={entry.response.body}
        name="body"
        collapsed={2}
      />
    )},
  ] : [];

  return (
    <div className={styles.packetDetail}>
      <Timeline className={styles.timeline}>
        <Timeline.Item color="blue">
          <div className={styles.timelineLabel}>
            {t('network.request_time')}: {entry.timestamp}
          </div>
          <Card size="small" className={styles.timelineCard}>
            <div className={styles.requestLine}>
              <Text strong>{entry.method}</Text>
              <SwapRightOutlined />
              <Text code>{entry.url}</Text>
            </div>
            <Tabs items={requestItems} size="small" />
          </Card>
        </Timeline.Item>

        {entry.response && (
          <Timeline.Item color={entry.response.status >= 400 ? 'red' : 'green'}>
            <div className={styles.timelineLabel}>
              {t('network.response_time')}: {entry.duration}ms · {entry.response.status} {entry.response.statusText}
            </div>
            <Card size="small" className={styles.timelineCard}>
              <Tabs items={responseItems} size="small" />
            </Card>
          </Timeline.Item>
        )}
      </Timeline>
    </div>
  );
};

/**
 * 网络报文主组件
 */
class NetworkPacketView extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      filterType: 'all',
      searchText: '',
      expandedRowKeys: [],
    };
  }

  /**
   * 过滤报文
   */
  filterPackets = (packets) => {
    const { filterType, searchText } = this.state;

    return packets.filter((packet) => {
      const entry = packet.requestEntry || packet;

      // 类型过滤
      if (filterType !== 'all') {
        if (filterType === 'mainAgent' && !entry.mainAgent) return false;
        if (filterType === 'teammate' && !entry.teammate) return false;
        if (filterType === 'stream' && !entry.isStream) return false;
        if (filterType === 'completed' && !entry.response) return false;
      }

      // 搜索过滤
      if (searchText) {
        const searchLower = searchText.toLowerCase();
        const matchUrl = entry.url?.toLowerCase().includes(searchLower);
        const matchModel = entry.body?.model?.toLowerCase().includes(searchLower);
        return matchUrl || matchModel;
      }

      return true;
    });
  };

  render() {
    const { packets = [] } = this.props;
    const { filterType, searchText, expandedRowKeys } = this.state;

    const filteredPackets = this.filterPackets(packets);

    const columns = [
      {
        title: t('network.col_type'),
        key: 'type',
        width: 100,
        render: (_, record) => {
          const entry = record.requestEntry || record;
          return (
            <Space direction="vertical" size={0}>
              {entry.mainAgent && <Tag color="purple">Main</Tag>}
              {entry.teammate && <Tag color="cyan">Team</Tag>}
              {!entry.mainAgent && !entry.teammate && <Tag>API</Tag>}
            </Space>
          );
        },
      },
      {
        title: t('network.col_method'),
        key: 'method',
        width: 80,
        render: (_, record) => {
          const entry = record.requestEntry || record;
          return <Tag>{entry.method}</Tag>;
        },
      },
      {
        title: t('network.col_url'),
        key: 'url',
        ellipsis: true,
        render: (_, record) => {
          const entry = record.requestEntry || record;
          try {
            const url = new URL(entry.url);
            return <Text code>{url.pathname + url.search}</Text>;
          } catch {
            return <Text code>{entry.url}</Text>;
          }
        },
      },
      {
        title: t('network.col_status'),
        key: 'status',
        width: 100,
        render: (_, record) => {
          const entry = record.requestEntry || record;
          const status = entry.response?.status;
          return status ? (
            <Tag color={getStatusColor(status)}>{status}</Tag>
          ) : (
            <Badge status="processing" text={t('network.pending')} />
          );
        },
      },
      {
        title: t('network.col_time'),
        key: 'time',
        width: 120,
        render: (_, record) => {
          const entry = record.requestEntry || record;
          if (entry.duration) {
            return (
              <Tooltip title={t('network.response_time')}>
                <Text>{entry.duration}ms</Text>
              </Tooltip>
            );
          }
          return '-';
        },
      },
      {
        title: t('network.col_model'),
        key: 'model',
        width: 150,
        render: (_, record) => {
          const info = extractKeyInfo(record);
          return info.model !== '-' ? <Tag color="gold">{info.model}</Tag> : '-';
        },
      },
      {
        title: t('network.col_tokens'),
        key: 'tokens',
        width: 120,
        render: (_, record) => {
          const info = extractKeyInfo(record);
          const total = info.tokenInput + info.tokenOutput;
          return total > 0 ? (
            <Text type="secondary">{info.tokenInput} / {info.tokenOutput}</Text>
          ) : '-';
        },
      },
    ];

    return (
      <div className={styles.networkPacketView}>
        {/* 过滤器 */}
        <div className={styles.filterBar}>
          <Space>
            <Select
              value={filterType}
              onChange={(v) => this.setState({ filterType: v })}
              style={{ width: 140 }}
              prefix={<FilterOutlined />}
            >
              <Option value="all">{t('network.filter_all')}</Option>
              <Option value="mainAgent">{t('network.filter_main_agent')}</Option>
              <Option value="teammate">{t('network.filter_teammate')}</Option>
              <Option value="stream">{t('network.filter_stream')}</Option>
              <Option value="completed">{t('network.filter_completed')}</Option>
            </Select>
            <Input.Search
              placeholder={t('network.search_placeholder')}
              value={searchText}
              onChange={(e) => this.setState({ searchText: e.target.value })}
              style={{ width: 250 }}
              allowClear
            />
            <Text type="secondary">
              {filteredPackets.length} / {packets.length} {t('network.packets')}
            </Text>
          </Space>
        </div>

        {/* 报文表格 */}
        <Table
          dataSource={filteredPackets}
          columns={columns}
          rowKey={(record) => record.traceId || record.requestEntry?.requestId || Math.random().toString()}
          expandable={{
            expandedRowRender: (record) => <PacketDetail packet={record} />,
            expandRowByClick: true,
            expandedRowKeys,
            onExpandedRowsChange: (keys) => this.setState({ expandedRowKeys: keys }),
          }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => t('network.total', { total }),
          }}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      </div>
    );
  }
}

export default NetworkPacketView;
