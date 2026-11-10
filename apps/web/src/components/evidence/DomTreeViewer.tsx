import { useState } from 'react'

interface DomNode {
  tag: string
  id?: string
  classes: string[]
  text?: string
  children: DomNode[]
}

interface Props {
  nodes: DomNode[]
  depth?: number
}

function NodeRow({ node, depth = 0 }: { node: DomNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children.length > 0
  const classStr = node.classes.slice(0, 2).join(' ')
  const label = `<${node.tag}${node.id ? `#${node.id}` : ''}${classStr ? ` .${classStr}` : ''}>`
  const preview = node.text?.slice(0, 40)

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <div className="flex items-start gap-1 py-0.5 hover:bg-gray-50 rounded cursor-default text-xs font-mono">
        {hasChildren ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-gray-400 w-4 shrink-0"
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="text-indigo-700">{label}</span>
        {preview && <span className="text-gray-400 truncate max-w-xs">{preview}</span>}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child, i) => (
            <NodeRow key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function DomTreeViewer({ nodes }: Props) {
  if (nodes.length === 0) {
    return <p className="text-sm text-gray-500">No DOM data available.</p>
  }
  return (
    <div className="overflow-auto max-h-[60vh]">
      {nodes.map((n, i) => <NodeRow key={i} node={n} />)}
    </div>
  )
}
