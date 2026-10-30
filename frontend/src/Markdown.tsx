// Just enough markdown for what the test case files use: `code`, **bold**, bullets, numbered lists and tables.

export function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.length > 2 && part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
        if (part.length > 4 && part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
        return part
      })}
    </>
  )
}

type BlockNode = { type: 'p' | 'ul' | 'ol'; items: string[] } | { type: 'table'; rows: string[][] }

function toBlocks(text: string): BlockNode[] {
  const blocks: BlockNode[] = []
  let current: BlockNode | null = null
  const start = (type: 'p' | 'ul' | 'ol', first: string) => {
    current = { type, items: [first] }
    blocks.push(current)
  }
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('|')) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim())
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
      const open = current as BlockNode | null
      if (open?.type === 'table') open.rows.push(cells)
      else {
        current = { type: 'table', rows: [cells] }
        blocks.push(current)
      }
      continue
    }
    if (!line.trim()) {
      current = null
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
    const open = (current as BlockNode | null)?.type === 'table' ? null : (current as Exclude<BlockNode, { type: 'table' }> | null)
    if (bullet) {
      if (open?.type === 'ul') open.items.push(bullet[1])
      else start('ul', bullet[1])
    } else if (numbered) {
      if (open?.type === 'ol') open.items.push(numbered[1])
      else start('ol', numbered[1])
    } else if (open && (open.type === 'p' || /^\s/.test(line))) {
      open.items[open.items.length - 1] += ` ${line.trim()}`
    } else {
      start('p', line.trim())
    }
  }
  return blocks
}

export function Block({ text }: { text: string }) {
  return (
    <div className="md">
      {toBlocks(text).map((block, i) => {
        if (block.type === 'table') {
          const [head, ...body] = block.rows
          return (
            <div key={i} className="md-table">
              <table>
                <thead>
                  <tr>
                    {head.map((cell, j) => (
                      <th key={j}>
                        <Inline text={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td key={k}>
                          <Inline text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.type === 'p') {
          return (
            <p key={i}>
              <Inline text={block.items[0]} />
            </p>
          )
        }
        const List = block.type
        return (
          <List key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline text={item} />
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
