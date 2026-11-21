'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CostRow } from '@/lib/ads-performance'

type LeadRow = {
  platform: string; entity_id: string | null; name?: string; campaign_id?: string; ad_group_id?: string
  leads: number; qualified: number; converted: number; junk: number
}
type Report = {
  rows: LeadRow[]
  tags: { id: string; name: string }[]
  spend: Record<string, { state: string; rows: CostRow[] }>
}

const platforms: Record<string, string> = { all: 'All platforms', meta: 'Meta', google: 'Google', unattributed: 'Unattributed' }
const sources = ['manual', 'whatsapp', 'instagram_dm', 'messenger', 'meta_instant_form', 'google_lead_form', 'website_form', 'other']
const statuses = ['new', 'interested', 'not_interested', 'busy', 'no_response', 'in_process', 'qualified', 'converted', 'completed', 'junk']
const field = 'mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm'
const day = (time: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', dateStyle: 'short' }).format(time)
const label = (value: string) => value[0].toUpperCase() + value.slice(1).replaceAll('_', ' ')
const rowKey = (platform: string, id: string | null) => JSON.stringify([platform, id])
const money = (value: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
const unavailable: Record<string, string> = {
  not_configured: 'spend connection required',
  unavailable: 'spend temporarily unavailable',
  timezone_mismatch: 'account time zone differs from the report',
  filtered: 'spend hidden for CRM-only filters',
}

function csvCell(value: string | number) {
  const text = String(value)
  const safe = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text
  return '"' + safe.replaceAll('"', '""') + '"'
}

export default function AdsPerformancePage() {
  const [filters, setFilters] = useState(() => ({
    from: day(Date.now() - 29 * 86_400_000), to: day(Date.now()), platform: 'all', level: 'campaign', source: '', status: '', tag: '',
  }))
  const [applied, setApplied] = useState(filters)
  const [report, setReport] = useState<Report>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/ads-performance?' + new URLSearchParams(applied), { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setReport(data)
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message || 'Unable to load the report.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [applied])

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    setApplied({ ...filters })
  }

  const rows = new Map<string, LeadRow & { cost?: CostRow }>()
  for (const row of report?.rows ?? []) rows.set(rowKey(row.platform, row.entity_id), row)
  for (const [platform, feed] of Object.entries(report?.spend ?? {})) {
    for (const cost of feed.rows) {
      const key = rowKey(platform, cost.entity_id)
      const row = rows.get(key)
      rows.set(key, row
        ? { ...row, name: row.name || cost.name, campaign_id: row.campaign_id || cost.campaign_id, ad_group_id: row.ad_group_id || cost.ad_group_id, cost }
        : { platform, entity_id: cost.entity_id, name: cost.name, campaign_id: cost.campaign_id, ad_group_id: cost.ad_group_id,
          leads: 0, qualified: 0, converted: 0, junk: 0, cost })
    }
  }
  const totals = [...rows.values()].reduce((sum, row) => ({
    leads: sum.leads + row.leads, qualified: sum.qualified + row.qualified, converted: sum.converted + row.converted, junk: sum.junk + row.junk,
  }), { leads: 0, qualified: 0, converted: 0, junk: 0 })

  function exportCsv() {
    const cells = [
      ['From (IST)', 'To (IST)', 'Level', 'Platform', 'Entity ID', 'Name', 'Campaign ID', 'Ad set / group ID', 'Leads', 'Qualified', 'Converted', 'Junk', 'Spend', 'Currency', 'CPL', 'CPQL'],
      ...[...rows.values()].map((row) => [
        applied.from, applied.to, applied.level, row.platform, row.entity_id ?? '', row.name ?? '',
        row.campaign_id ?? '', row.ad_group_id ?? '', row.leads, row.qualified, row.converted, row.junk, row.cost?.spend ?? '',
        row.cost?.currency ?? '', row.cost && row.leads ? row.cost.spend / row.leads : '',
        row.cost && row.qualified ? row.cost.spend / row.qualified : '',
      ]),
    ]
    const url = URL.createObjectURL(new Blob([cells.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `ads-performance-${applied.from}-${applied.to}.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">Dashboard</Link>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Ads performance</h2>
          <p className="text-sm text-muted-foreground">CRM lead cohorts and ad spend by campaign, ad set or ad. Dates use India Standard Time.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={loading || !!error || !rows.size}><Download /> Export CSV</Button>
      </div>

      <form onSubmit={apply} className="grid grid-cols-2 items-end gap-3 rounded-xl border bg-card p-4 md:grid-cols-4 xl:grid-cols-8">
        {(['from', 'to'] as const).map(key => (
          <label key={key} className="text-xs font-medium">{label(key)}
            <input required type="date" value={filters[key]} onChange={event => setFilters({ ...filters, [key]: event.target.value })} className={field} />
          </label>
        ))}
        {[
          { key: 'platform', title: 'Platform', values: Object.entries(platforms).slice(0, 3) },
          { key: 'level', title: 'Group by', values: [['campaign', 'Campaign'], ['ad_group', 'Ad set / group'], ['ad', 'Ad']] },
          { key: 'source', title: 'Lead source', values: [['', 'All sources'], ...sources.map(value => [value, label(value)])] },
          { key: 'status', title: 'CRM status', values: [['', 'All statuses'], ...statuses.map(value => [value, label(value)])] },
          { key: 'tag', title: 'Contact tag', values: [['', 'All tags'], ...(report?.tags ?? []).map(tag => [tag.id, tag.name])] },
        ].map(({ key, title, values }) => (
          <label key={key} className="text-xs font-medium">{title}
            <select value={filters[key as keyof typeof filters]} onChange={event => setFilters({ ...filters, [key]: event.target.value })} className={field}>
              {values.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </label>
        ))}
        <Button type="submit" disabled={loading}>Apply filters</Button>
      </form>

      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading report…</p> : error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Object.entries(totals).map(([key, count]) => (
              <div key={key} className="rounded-xl border bg-card p-4">
                <p className="text-sm text-muted-foreground">{label(key)}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{count.toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {Object.entries(report.spend).map(([platform, feed]) => (
              <p key={platform}>{platforms[platform]} · {feed.state === 'ready' ? 'Spend loaded' : unavailable[feed.state]}</p>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>{['Platform', 'Name / ID', 'Leads', 'Qualified', 'Converted', 'Junk', 'Spend', 'Cost / lead', 'Cost / qualified'].map(col =>
                  <th key={col} scope="col" className="px-4 py-3 font-medium">{col}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {[...rows.values()].map(row => (
                  <tr key={rowKey(row.platform, row.entity_id)}>
                    <td className="px-4 py-3">{platforms[row.platform]}</td>
                    <td className="px-4 py-3 font-medium">
                      {row.name || row.entity_id || 'No ad ID'}
                      {row.name && row.entity_id && <span className="block text-xs text-muted-foreground">{row.entity_id}</span>}
                    </td>
                    {[row.leads, row.qualified, row.converted, row.junk].map((count, index) =>
                      <td key={index} className="px-4 py-3 tabular-nums">{count}</td>)}
                    <td className="px-4 py-3">{row.cost ? money(row.cost.spend, row.cost.currency) : '—'}</td>
                    <td className="px-4 py-3">{row.cost && row.leads ? money(row.cost.spend / row.leads, row.cost.currency) : '—'}</td>
                    <td className="px-4 py-3">{row.cost && row.qualified ? money(row.cost.spend / row.qualified, row.cost.currency) : '—'}</td>
                  </tr>
                ))}
                {!rows.size && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No results for these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
