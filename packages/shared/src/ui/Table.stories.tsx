import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import Table from './Table'
import Badge from './Badge'

interface Session {
  id: string
  agent: string
  status: string
  duration: number
  toolCalls: number
}

const sampleData: Session[] = [
  {
    id: 's-001',
    agent: 'code-review-bot',
    status: 'completed',
    duration: 12400,
    toolCalls: 5
  },
  {
    id: 's-002',
    agent: 'deploy-agent',
    status: 'running',
    duration: 3200,
    toolCalls: 2
  },
  {
    id: 's-003',
    agent: 'security-scanner',
    status: 'failed',
    duration: 45000,
    toolCalls: 12
  },
  {
    id: 's-004',
    agent: 'test-runner',
    status: 'completed',
    duration: 8700,
    toolCalls: 8
  },
  {
    id: 's-005',
    agent: 'code-review-bot',
    status: 'completed',
    duration: 6100,
    toolCalls: 3
  }
]

const columns = [
  {
    key: 'agent',
    header: 'Agent',
    sortable: true,
    render: (row: Session) => row.agent
  },
  {
    key: 'status',
    header: 'Status',
    sortable: true,
    render: (row: Session) => {
      const variant =
        row.status === 'completed' ? 'success' : row.status === 'running' ? 'info' : 'danger'
      return <Badge variant={variant}>{row.status}</Badge>
    }
  },
  {
    key: 'duration',
    header: 'Duration',
    sortable: true,
    numeric: true,
    render: (row: Session) => `${(row.duration / 1000).toFixed(1)}s`
  },
  {
    key: 'toolCalls',
    header: 'Tool Calls',
    sortable: true,
    numeric: true,
    render: (row: Session) => row.toolCalls
  }
]

const meta: Meta<typeof Table<Session>> = {
  title: 'UI/Table',
  parameters: { layout: 'padded' }
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => <Table columns={columns} data={sampleData} getRowKey={(r: Session) => r.id} />
}

export const WithSortableColumns: Story = {
  render: () => (
    <Table columns={columns} data={sampleData} getRowKey={(r: Session) => r.id} onRowClick={fn()} />
  )
}

export const Loading: Story = {
  render: () => <Table columns={columns} data={[]} loading getRowKey={(r: Session) => r.id} />
}

export const Empty: Story = {
  render: () => <Table columns={columns} data={[]} getRowKey={(r: Session) => r.id} />
}

export const ClickableRows: Story = {
  render: () => (
    <Table columns={columns} data={sampleData} getRowKey={(r: Session) => r.id} onRowClick={fn()} />
  )
}
