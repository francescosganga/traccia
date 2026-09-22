import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { AgentInstallResult, AgentTarget, AgentTargetStatus, McpCommands } from '../../../shared/types'
import { Icon } from './Icon'

type Notice = { kind: 'ok' | 'error'; text: string }

/** Settings section that registers the bundled MCP server with the AI clients found on this machine. */
export function AgentsPanel() {
  const [targets, setTargets] = useState<AgentTargetStatus[] | null>(null)
  const [commands, setCommands] = useState<McpCommands | null>(null)
  const [busy, setBusy] = useState<AgentTarget | 'file' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [copied, setCopied] = useState<'json' | 'command' | null>(null)

  const refresh = () => void window.api.agents.targets().then(setTargets)

  useEffect(() => {
    refresh()
    void window.api.agents.commands().then(setCommands)
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const report = (target: AgentTarget | 'file', res: AgentInstallResult | null) => {
    if (!res) return
    if (!res.ok) setNotice({ kind: 'error', text: t('agents.failed', { error: res.error ?? res.path }) })
    else setNotice({ kind: 'ok', text: target === 'claude-code' ? t('agents.doneClaudeCode') : t('agents.done', { path: res.path }) })
    refresh()
  }

  const install = async (target: AgentTarget) => {
    setBusy(target)
    setNotice(null)
    try {
      report(target, await window.api.agents.install(target))
    } finally {
      setBusy(null)
    }
  }

  const installInFile = async () => {
    setBusy('file')
    setNotice(null)
    try {
      report('file', await window.api.agents.installInFile())
    } finally {
      setBusy(null)
    }
  }

  const copy = async (what: 'json' | 'command') => {
    if (!commands) return
    await window.api.system.copyText(what === 'json' ? commands.json : commands.claude)
    setCopied(what)
  }

  return (
    <div className="stack">
      <p className="small dim">{t('agents.intro')}</p>
      <div className="list">
        {(targets ?? []).map((target) => (
          <div className="list-item" key={target.id}>
            <div className="stack tight">
              <div className="row">
                <strong>{t(`agents.${target.id}.label`)}</strong>
                {target.configured !== 'no' && (
                  <span className={`badge ${target.configured === 'yes' ? 'ok' : 'warn'}`}>
                    <span className="dot" /> {target.configured === 'yes' ? t('agents.configured') : t('agents.stale')}
                  </span>
                )}
              </div>
              <span className="small dim">{target.available && target.path ? target.path : t(`agents.missing.${target.id}`)}</span>
            </div>
            <div className="row">
              <button className="btn sm" disabled={!target.available || busy !== null} onClick={() => void install(target.id)}>
                {target.configured === 'no' ? t('agents.add') : t('agents.update')}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="row wrap">
        <button className="btn ghost sm" onClick={() => void copy('json')}>
          <Icon name={copied === 'json' ? 'check' : 'copy'} />
          {t('agents.copyJson')}
        </button>
        <button className="btn ghost sm" onClick={() => void copy('command')}>
          <Icon name={copied === 'command' ? 'check' : 'copy'} />
          {t('agents.copyCommand')}
        </button>
        <button className="btn ghost sm" disabled={busy !== null} onClick={() => void installInFile()}>
          <Icon name="file" />
          {t('agents.addToFile')}
        </button>
      </div>
      {notice && (
        <div className={`notice ${notice.kind}`}>
          <Icon name={notice.kind === 'ok' ? 'check' : 'alert'} />
          <span>{notice.text}</span>
        </div>
      )}
      <div className="field">
        <label>{t('agents.command')}</label>
        <code className="path">{commands?.launch}</code>
      </div>
      <p className="small dim">{t('agents.note')}</p>
    </div>
  )
}
