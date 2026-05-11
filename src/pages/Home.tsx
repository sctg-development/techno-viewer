/**
 * Copyright (c) Ronan Le Meillat - SCTG Development 2008-2026
 * Licensed under the MIT License
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@heroui/react'
import { FileText, Layers, ChevronRight } from 'lucide-react'
import { useAuthContext } from '../context/AuthContext'

interface TechnicalDrawingLabels {
  sensor: string
  array: string
  figure: string
  unit: string
}

/** Decorative inline SVG illustration mimicking a simplified technical schematic, used on the home page hero. */
function TechnicalDrawingSvg({ labels }: { labels: TechnicalDrawingLabels }) {
  return (
    <svg
      viewBox="0 0 200 160"
      className="w-full h-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer housing */}
      <rect x="20" y="20" width="160" height="120" rx="2" stroke="#c0392b" strokeWidth="1.5" fill="none" />
      <rect x="30" y="30" width="140" height="100" rx="1" stroke="#888" strokeWidth="0.5" fill="none" />

      {/* Sensor array (right side) */}
      <rect x="130" y="45" width="40" height="70" rx="1" stroke="#c0392b" strokeWidth="1" fill="#f4eed7" />
      <text x="150" y="83" fontSize="8" fill="#c0392b" textAnchor="middle" fontFamily="monospace">{labels.sensor}</text>
      <text x="150" y="93" fontSize="8" fill="#c0392b" textAnchor="middle" fontFamily="monospace">{labels.array}</text>

      {/* Fig label */}
      <text x="140" y="42" fontSize="7" fill="#888" fontFamily="monospace">{labels.figure}</text>

      {/* Circuit lines */}
      <line x1="40" y1="60" x2="125" y2="60" stroke="#888" strokeWidth="0.5" />
      <line x1="40" y1="80" x2="125" y2="80" stroke="#888" strokeWidth="0.5" />
      <line x1="40" y1="100" x2="125" y2="100" stroke="#888" strokeWidth="0.5" />

      {/* Connectors */}
      <circle cx="40" cy="60" r="2" fill="#c0392b" />
      <circle cx="40" cy="80" r="2" fill="#c0392b" />
      <circle cx="40" cy="100" r="2" fill="#c0392b" />

      {/* Dimension lines */}
      <line x1="20" y1="145" x2="180" y2="145" stroke="#888" strokeWidth="0.5" />
      <line x1="20" y1="142" x2="20" y2="148" stroke="#888" strokeWidth="0.5" />
      <line x1="180" y1="142" x2="180" y2="148" stroke="#888" strokeWidth="0.5" />
      <text x="100" y="155" fontSize="7" fill="#888" textAnchor="middle" fontFamily="monospace">{labels.unit}</text>

      <line x1="8" y1="20" x2="8" y2="140" stroke="#888" strokeWidth="0.5" />
      <line x1="5" y1="20" x2="11" y2="20" stroke="#888" strokeWidth="0.5" />
      <line x1="5" y1="140" x2="11" y2="140" stroke="#888" strokeWidth="0.5" />
      <text x="4" y="83" fontSize="7" fill="#888" textAnchor="middle" fontFamily="monospace"
        transform="rotate(-90,4,83)">{labels.unit}</text>
    </svg>
  )
}

/** Home page. Displays a hero section, quick-access navigation cards, and a sample technical-spec table. */
export default function Home() {
  const { t } = useTranslation()
  const { isAuthenticated } = useAuthContext()
  const navigate = useNavigate()

  const technicalDrawingLabels: TechnicalDrawingLabels = {
    sensor: t('home.schematic.sensor'),
    array: t('home.schematic.array'),
    figure: t('home.schematic.figure'),
    unit: t('home.schematic.unit_mm'),
  }

  const quickLinks = [
    { key: 'home.datasheet', icon: <FileText className="size-5" />, to: '/docs' },
    { key: 'home.drawings', icon: <Layers className="size-5" />, to: '/drawings' },
    { key: 'home.calibration', icon: <FileText className="size-5" />, to: '/docs' },
  ]

  const specHeaders = [
    t('home.spec_headers.parameter'),
    t('home.spec_headers.value_left'),
    t('home.spec_headers.value_right'),
  ]

  const specRows = [
    {
      param: t('home.spec_rows.range_label'),
      v1: t('home.spec_rows.range_v1'),
      v2: t('home.spec_rows.range_v2'),
    },
    {
      param: t('home.spec_rows.accuracy_label'),
      v1: t('home.spec_rows.accuracy_v1'),
      v2: t('home.spec_rows.accuracy_v2'),
    },
    {
      param: t('home.spec_rows.power_label'),
      v1: t('home.spec_rows.power_v1'),
      v2: t('home.spec_rows.power_v2'),
    },
    {
      param: t('home.spec_rows.output_label'),
      v1: t('home.spec_rows.output_v1'),
      v2: t('home.spec_rows.output_v2'),
    },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-12 space-y-16">

      {/* ── Hero section ─────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="space-y-4">
          <p className="section-title">// {t('home.brand_label')}</p>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight uppercase tracking-tight">
            {t('hero.title')}
            <br />
            <span className="text-tech-red">{t('hero.subtitle')}</span>
          </h1>
          <p className="font-mono text-ink-600 text-sm tracking-wide">
            {t('hero.tagline')}
          </p>

          {isAuthenticated && (
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                onPress={() => navigate('/drawings')}
                className="btn-tech flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground"
              >
                <Layers className="size-4" />
                {t('home.open_drawings')}
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                onPress={() => navigate('/docs')}
                className="btn-tech flex items-center gap-2 px-6 py-2"
              >
                <FileText className="size-4" />
                {t('home.open_docs')}
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Technical drawing */}
        <div className="tech-corner relative border border-border/60 bg-paper-50 p-4 aspect-[5/4]">
          <TechnicalDrawingSvg labels={technicalDrawingLabels} />
        </div>
      </section>

      {/* ── Quick access buttons ─────────────────────────────── */}
      <section className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {quickLinks.map(({ key, icon, to }) => (
            <Link key={key} to={isAuthenticated ? to : '/'}>
              <div className="tech-corner border border-border hover:border-tech-red/60 bg-surface hover:bg-paper-100 transition-colors p-5 flex items-center gap-3 group cursor-pointer">
                <span className="text-ink-400 group-hover:text-tech-red transition-colors">
                  {icon}
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.15em] group-hover:text-tech-red transition-colors">
                  {t(key)}
                </span>
                <ChevronRight className="size-3 ml-auto text-ink-400 group-hover:text-tech-red" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Technical specs table ────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="section-title border-b border-border/50 pb-2">
          — {t('home.technical_specs')}
        </h2>
        <div className="border border-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-3 border-b border-border bg-muted">
            {specHeaders.map((h, i) => (
              <div key={i} className="px-4 py-2 font-mono text-xs uppercase tracking-wider text-ink-600 border-r last:border-r-0 border-border">
                {h}
              </div>
            ))}
          </div>
          {/* Dimension lines SVG overlay */}
          <div className="relative">
            {specRows.map(({ param, v1, v2 }, i) => (
              <div key={i} className={`grid grid-cols-3 border-b border-border/40 last:border-b-0 ${i % 2 === 0 ? 'bg-surface' : 'bg-paper-50'}`}>
                <div className="px-4 py-2 font-mono text-xs text-ink-800 border-r border-border/40">{param}</div>
                <div className="px-4 py-2 font-mono text-xs text-ink-600 border-r border-border/40">{v1}</div>
                <div className="px-4 py-2 font-mono text-xs text-ink-600">{v2}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-end px-4 py-1 bg-muted/50">
            <span className="font-mono text-xs text-ink-400">{t('home.spec_table_id')}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
