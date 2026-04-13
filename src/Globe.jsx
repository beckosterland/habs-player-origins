import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import * as topojson from 'topojson-client'
import { geoVanDerGrinten4 } from 'd3-geo-projection'
import './Globe.css'

const WORLD_URL      = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
const LAKES_URL      = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@5.1.2/geojson/ne_50m_lakes.geojson'
const SUBNATIONAL_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@5.1.2/geojson/ne_110m_admin_1_states_provinces.geojson'
// import.meta.env.BASE_URL is '/' in dev and '/habs-player-origins/' in production
const PLAYERS_URL = `${import.meta.env.BASE_URL}data/mtl_historical_players.csv`
const ARENAS_URL  = `${import.meta.env.BASE_URL}data/mtl_arenas.csv`

const CH_RED  = '#AF1E2D'
const CH_BLUE = '#192168'

// All seasons where Montreal won the Stanley Cup (season start year → 8-digit code)
const CUP_WINS = new Set([
  '19231924', '19291930', '19301931',
  '19431944', '19451946',
  '19521953',
  '19551956', '19561957', '19571958', '19581959', '19591960',
  '19641965', '19651966',
  '19671968', '19681969',
  '19701971', '19721973',
  '19751976', '19761977', '19771978', '19781979',
  '19851986',
  '19921993',
])

const POSITION_FULL = {
  C: 'Centre',
  L: 'Left Wing',
  R: 'Right Wing',
  D: 'Defenceman',
  G: 'Goaltender',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getArenaForSeason(arenas, seasonStr) {
  const startYear = parseInt(String(seasonStr).substring(0, 4))
  return arenas.find(a => +a.year_start <= startYear && +a.year_end > startYear)
}

function shortSeason(s) {
  return `${String(s).substring(2, 4)}-${String(s).substring(6, 8)}`
}

function longSeason(s) {
  return `${String(s).substring(0, 4)}–${String(s).substring(4)}`
}

function formatBirthdate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`
}

function statOrDash(val) {
  return (val === '' || val == null) ? '—' : val
}

// Build career totals from an array of player-season rows for one player
function buildCareerTotals(rows) {
  if (!rows?.length) return null
  const isGoalie   = rows[0].position === 'G'
  const numSeasons = rows.length
  const sum = (key) => rows.reduce((s, r) => s + (+r[key] || 0), 0)

  if (!isGoalie) {
    return {
      games_played: sum('games_played'),
      goals:        sum('goals'),
      assists:      sum('assists'),
      points:       sum('points'),
      plus_minus:   sum('plus_minus'),
      pim:          sum('pim'),
      numSeasons,
    }
  }

  // Goalies: sum counting stats, weighted-average rate stats by GP
  const gp = sum('games_played')
  let gaaSum = 0, svSum = 0, gpW = 0
  for (const r of rows) {
    const g = +r.games_played || 0
    if (g > 0 && r.goals_against_avg !== '') {
      gaaSum += (+r.goals_against_avg || 0) * g
      svSum  += (+r.save_pct          || 0) * g
      gpW    += g
    }
  }
  return {
    games_played:      gp,
    wins:              sum('wins'),
    losses:            sum('losses'),
    shutouts:          sum('shutouts'),
    goals_against_avg: gpW ? (gaaSum / gpW).toFixed(2) : '',
    save_pct:          gpW ? (svSum  / gpW).toFixed(3)  : '',
    numSeasons,
  }
}

// ── Player detail panel ───────────────────────────────────────────────────────

function PlayerPanel({ data, onClose }) {
  if (!data) return null
  const { player, contextSeason, careerTotals } = data
  const isGoalie     = player.position === 'G'
  const isAllSeasons = contextSeason === 'all' && careerTotals
  const statSeason   = contextSeason === 'all' ? player.season : contextSeason
  const stats        = isAllSeasons ? careerTotals : player
  const birthParts   = [player.birth_city, player.birth_state_province, player.birth_country].filter(Boolean)

  return (
    <div className="player-panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">×</button>

      <div className="panel-headshot-wrap">
        <img
          className="panel-headshot"
          src={player.headshot_url}
          alt={player.full_name}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </div>

      {player.jersey_number && (
        <div className="panel-jersey">{player.jersey_number}</div>
      )}

      <div className="panel-name">{player.full_name}</div>
      <div className="panel-position">{POSITION_FULL[player.position] || player.position}</div>

      <div className="panel-divider" />

      <div className="panel-section">
        <div className="panel-section-title">Personal</div>
        {birthParts.length > 0 && (
          <div className="panel-row">
            <span className="panel-row-label">Birthplace</span>
            <span className="panel-row-value">{birthParts.join(', ')}</span>
          </div>
        )}
        {player.birthdate && (
          <div className="panel-row">
            <span className="panel-row-label">Born</span>
            <span className="panel-row-value">{formatBirthdate(player.birthdate)}</span>
          </div>
        )}
        {player.nationality && (
          <div className="panel-row">
            <span className="panel-row-label">Nationality</span>
            <span className="panel-row-value">{player.nationality}</span>
          </div>
        )}
        {player.height && (
          <div className="panel-row">
            <span className="panel-row-label">Height</span>
            <span className="panel-row-value">{player.height}</span>
          </div>
        )}
        {player.weight_lbs && (
          <div className="panel-row">
            <span className="panel-row-label">Weight</span>
            <span className="panel-row-value">{player.weight_lbs} lbs</span>
          </div>
        )}
      </div>

      <div className="panel-divider" />

      <div className="panel-section">
        <div className="panel-section-title">
          {isAllSeasons
            ? `MTL Career · ${careerTotals.numSeasons} season${careerTotals.numSeasons !== 1 ? 's' : ''}`
            : `${longSeason(statSeason)} Season`}
        </div>
        <div className="panel-stats-grid">
          {!isGoalie ? (
            <>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.games_played)}</div><div className="panel-stat-label">GP</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.goals)}</div><div className="panel-stat-label">G</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.assists)}</div><div className="panel-stat-label">A</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.points)}</div><div className="panel-stat-label">PTS</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.plus_minus)}</div><div className="panel-stat-label">+/−</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.pim)}</div><div className="panel-stat-label">PIM</div></div>
            </>
          ) : (
            <>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.games_played)}</div><div className="panel-stat-label">GP</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.wins)}</div><div className="panel-stat-label">W</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.losses)}</div><div className="panel-stat-label">L</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.goals_against_avg)}</div><div className="panel-stat-label">GAA</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.save_pct)}</div><div className="panel-stat-label">SV%</div></div>
              <div className="panel-stat"><div className="panel-stat-val">{statOrDash(stats.shutouts)}</div><div className="panel-stat-label">SO</div></div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Globe component ───────────────────────────────────────────────────────────

export default function Globe() {
  const containerRef     = useRef(null)
  const svgRef           = useRef(null)
  const tooltipRef       = useRef(null)
  const updateRef        = useRef(null)
  const selectPlayerRef  = useRef(null)
  const currentSeasonRef = useRef('all')
  const careerTotalsRef  = useRef(null)   // Map<player_id, totals>

  const [activeSeason,   setActiveSeason]   = useState('all')
  const [seasons,        setSeasons]        = useState([])
  const [playerCount,    setPlayerCount]    = useState(0)
  const [seasonLabel,    setSeasonLabel]    = useState('All seasons')
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(null)
  const [selectedPlayer, setSelectedPlayer] = useState(null)

  useEffect(() => {
    selectPlayerRef.current = (data) => setSelectedPlayer(data)
  }, [])

  // ── D3 setup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const svgEl     = svgRef.current
    const tipEl     = tooltipRef.current
    if (!container || !svgEl) return

    const W = container.clientWidth  || 960
    const H = container.clientHeight || 520

    // ── Van der Grinten IV projection ────────────────────────────────────────
    // fitSize fills the viewport; scale/translate are computed automatically.
    const projection = geoVanDerGrinten4()
      .fitSize([W, H], { type: 'Sphere' })

    // Snapshot the fitted state — used to sync projection from d3.zoom() transform
    const initialScale     = projection.scale()
    const initialTranslate = projection.translate()
    const geoPath          = d3.geoPath().projection(projection)

    // ── SVG root ─────────────────────────────────────────────────────────────
    const svg = d3.select(svgEl).attr('width', W).attr('height', H)

    // Drop-shadow filter for the map boundary
    const defs   = svg.append('defs')
    const shadow = defs.append('filter').attr('id', 'map-shadow').attr('x', '-5%').attr('y', '-5%').attr('width', '110%').attr('height', '110%')
    shadow.append('feDropShadow').attr('dx', 0).attr('dy', 2).attr('stdDeviation', 6).attr('flood-color', 'rgba(0,0,0,0.18)')

    // ── Map layers ────────────────────────────────────────────────────────────
    const g = svg.append('g')

    // Ocean (sphere fill)
    const spherePath = g.append('path')
      .datum({ type: 'Sphere' })
      .attr('class', 'map-sphere')
      .attr('filter', 'url(#map-shadow)')
      .attr('d', geoPath)

    // Graticule
    const gratPath = g.append('path')
      .datum(d3.geoGraticule()())
      .attr('class', 'map-graticule')
      .attr('d', geoPath)

    // Land
    const landPath      = g.append('path').attr('class', 'map-land')
    // US states + Canadian provinces (drawn above land, below lakes)
    const subnatPath    = g.append('path').attr('class', 'map-subnational')
    // Lakes
    const lakesPath     = g.append('path').attr('class', 'map-lakes')
    // Country borders
    const borderPath    = g.append('path').attr('class', 'map-borders')

    // Player/arc layer
    const playerG = g.append('g').attr('class', 'player-layer')

    // ── Redraw helpers ───────────────────────────────────────────────────────

    function redrawStatic() {
      spherePath.attr('d', geoPath)
      gratPath.attr('d', geoPath)
      if (landPath.datum())    landPath.attr('d', geoPath)
      if (subnatPath.datum())  subnatPath.attr('d', geoPath)
      if (lakesPath.datum())   lakesPath.attr('d', geoPath)
      if (borderPath.datum())  borderPath.attr('d', geoPath)
    }

    function redrawPositions() {
      playerG.selectAll('.arc-vis').attr('d', d => geoPath(d))
      playerG.selectAll('.arc-hit').attr('d', d => geoPath(d.arc))

      // Flat projection — no hemisphere check, just update projected position
      playerG.selectAll('.player-dot').each(function(group) {
        const p    = group[0]
        const proj = projection([+p.birth_lon, +p.birth_lat])
        d3.select(this)
          .attr('visibility', proj ? 'visible' : 'hidden')
          .attr('cx', proj ? proj[0] : 0)
          .attr('cy', proj ? proj[1] : 0)
      })

      playerG.selectAll('.arena-dot').each(function(d) {
        const proj = projection([+d.arena_lon, +d.arena_lat])
        d3.select(this)
          .attr('visibility', proj ? 'visible' : 'hidden')
          .attr('cx', proj ? proj[0] : 0)
          .attr('cy', proj ? proj[1] : 0)
      })
    }

    // ── Tooltip ───────────────────────────────────────────────────────────────
    const tipSel = d3.select(tipEl)

    let pinnedTooltip = false

    function hideTooltip() {
      if (pinnedTooltip) return
      tipSel.classed('visible', false)
    }

    function forceHideTooltip() {
      pinnedTooltip = false
      tipSel.classed('visible', false).classed('pinned', false)
    }

    function buildSingleTooltip(player) {
      tipSel.html('')

      if (player.jersey_number) {
        tipSel.append('div').attr('class', 'tt-jersey').text(`${player.jersey_number}`)
      }
      tipSel.append('img')
        .attr('class', 'tt-img')
        .attr('src', player.headshot_url || '')
        .attr('alt', player.full_name)
        .on('error', function () { d3.select(this).style('display', 'none') })
      tipSel.append('div').attr('class', 'tt-name').text(player.full_name)

      const birthParts = [player.birth_city, player.birth_state_province, player.birth_country].filter(Boolean)
      if (birthParts.length) {
        const b = tipSel.append('div').attr('class', 'tt-info-block')
        b.append('span').attr('class', 'tt-label').text('Birthplace')
        b.append('span').attr('class', 'tt-value').text(birthParts.join(', '))
      }
      if (player.birthdate) {
        const d = tipSel.append('div').attr('class', 'tt-info-block')
        d.append('span').attr('class', 'tt-label').text('Born')
        d.append('span').attr('class', 'tt-value').text(formatBirthdate(player.birthdate))
      }
    }

    function buildClusterTooltip(players, contextSeason) {
      tipSel.html('')

      const p0  = players[0]
      const loc = [p0.birth_city, p0.birth_country].filter(Boolean).join(', ')

      const headerRow = tipSel.append('div').attr('class', 'tt-cluster-top')
      headerRow.append('div').attr('class', 'tt-cluster-header')
        .text(`${players.length} players · ${loc}`)
      headerRow.append('button').attr('class', 'tt-cluster-close').text('×')
        .on('click', (e) => { e.stopPropagation(); forceHideTooltip() })

      const list  = tipSel.append('div').attr('class', 'tt-cluster-list')
      const shown = players.slice(0, 8)

      shown.forEach(player => {
        const item = list.append('div').attr('class', 'tt-cluster-item')
          .on('click', (e) => {
            e.stopPropagation()
            const careerTotals = contextSeason === 'all'
              ? careerTotalsRef.current?.get(player.player_id) ?? null
              : null
            selectPlayerRef.current?.({ player, contextSeason, careerTotals })
          })

        item.append('img').attr('class', 'tt-mini-img')
          .attr('src', player.headshot_url || '').attr('alt', '')
          .on('error', function () { d3.select(this).style('display', 'none') })

        const info = item.append('div').attr('class', 'tt-mini-info')
        info.append('div').attr('class', 'tt-mini-name').text(player.full_name)
        const sub = [
          player.jersey_number ? `#${player.jersey_number}` : null,
          POSITION_FULL[player.position] || player.position,
        ].filter(Boolean).join(' · ')
        info.append('div').attr('class', 'tt-mini-sub').text(sub)
      })

      if (players.length > 8) {
        tipSel.append('div').attr('class', 'tt-cluster-more')
          .text(`+${players.length - 8} more`)
      }
    }

    function showTooltip(event, group, contextSeason) {
      if (group.length === 1) buildSingleTooltip(group[0])
      else buildClusterTooltip(group, contextSeason)
      tipSel.classed('visible', true)
      positionTooltip(event)
    }

    function positionTooltip(event) {
      const x  = event.clientX + 16
      const y  = event.clientY - 16
      const tw = tipEl.offsetWidth
      const th = tipEl.offsetHeight
      tipEl.style.left = (x + tw > window.innerWidth  ? x - tw - 32 : x) + 'px'
      tipEl.style.top  = (y + th > window.innerHeight ? y - th + 32 : y) + 'px'
    }

    // ── Season update ────────────────────────────────────────────────────────

    function updateSeason(season, players, arenas, setCount) {
      playerG.selectAll('*').remove()
      forceHideTooltip()

      let display
      if (season === 'all') {
        const seen = new Map()
        for (const p of players) {
          if (p.birth_lat && p.birth_lon && !seen.has(p.player_id)) seen.set(p.player_id, p)
        }
        display = [...seen.values()]
      } else {
        display = players.filter(p => p.season === season && p.birth_lat && p.birth_lon)
      }

      setCount(display.length)
      const arcOpacity = season === 'all' ? 0.12 : 0.6

      // Arcs
      for (const player of display) {
        const arena = season === 'all'
          ? getArenaForSeason(arenas, player.season)
          : getArenaForSeason(arenas, season)
        if (!arena) continue

        const arcGeo = {
          type: 'LineString',
          coordinates: [
            [+player.birth_lon, +player.birth_lat],
            [+arena.arena_lon,  +arena.arena_lat],
          ]
        }

        playerG.append('path')
          .datum(arcGeo)
          .attr('class', 'arc-vis')
          .attr('fill', 'none')
          .attr('stroke', '#1e2d8a')
          .attr('stroke-width', 0.9)
          .attr('stroke-opacity', arcOpacity)
          .attr('pointer-events', 'none')
          .attr('d', geoPath(arcGeo))

        playerG.append('path')
          .datum({ arc: arcGeo, player })
          .attr('class', 'arc-hit')
          .attr('fill', 'none')
          .attr('stroke', 'transparent')
          .attr('stroke-width', 10)
          .attr('d', geoPath(arcGeo))
          .on('mouseover', (e, d) => { if (!pinnedTooltip) showTooltip(e, [d.player], currentSeasonRef.current) })
          .on('mousemove', (e) => { if (!pinnedTooltip) positionTooltip(e) })
          .on('mouseout',  hideTooltip)
          .on('click', (e, d) => {
            e.stopPropagation()
            forceHideTooltip()
            const ctxt = currentSeasonRef.current
            const careerTotals = ctxt === 'all'
              ? careerTotalsRef.current?.get(d.player.player_id) ?? null
              : null
            selectPlayerRef.current?.({ player: d.player, contextSeason: ctxt, careerTotals })
          })
      }

      // Group dots by coordinates
      const locationGroups = new Map()
      for (const player of display) {
        if (!player.birth_lat || !player.birth_lon) continue
        const key = `${player.birth_lat},${player.birth_lon}`
        if (!locationGroups.has(key)) locationGroups.set(key, [])
        locationGroups.get(key).push(player)
      }

      for (const [, group] of locationGroups) {
        const p     = group[0]
        const count = group.length
        const proj  = projection([+p.birth_lon, +p.birth_lat]) || [0, 0]
        const r     = count === 1 ? 4 : count <= 4 ? 5.5 : 7
        const fill  = CH_BLUE

        playerG.append('circle')
          .datum(group)
          .attr('class', 'player-dot')
          .attr('cx', proj[0]).attr('cy', proj[1])
          .attr('r', r)
          .attr('fill', fill)
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1)
          .attr('visibility', proj ? 'visible' : 'hidden')
          .on('mouseover', (e, d) => { if (!pinnedTooltip) showTooltip(e, d, currentSeasonRef.current) })
          .on('mousemove', (e) => { if (!pinnedTooltip) positionTooltip(e) })
          .on('mouseout',  hideTooltip)
          .on('click', (e, d) => {
            e.stopPropagation()
            if (d.length === 1) {
              forceHideTooltip()
              const ctxt = currentSeasonRef.current
              const careerTotals = ctxt === 'all'
                ? careerTotalsRef.current?.get(d[0].player_id) ?? null
                : null
              selectPlayerRef.current?.({ player: d[0], contextSeason: ctxt, careerTotals })
            } else {
              pinnedTooltip = true
              showTooltip(e, d, currentSeasonRef.current)
              tipSel.classed('pinned', true)
            }
          })
      }

      // Arena marker
      if (season !== 'all') {
        const arena = getArenaForSeason(arenas, season)
        if (arena) {
          const proj = projection([+arena.arena_lon, +arena.arena_lat]) || [0, 0]

          playerG.append('circle')
            .datum(arena).attr('class', 'arena-dot arena-ring')
            .attr('cx', proj[0]).attr('cy', proj[1]).attr('r', 11)
            .attr('fill', 'none').attr('stroke', CH_RED)
            .attr('stroke-width', 1.5).attr('stroke-opacity', 0.45)
            .attr('pointer-events', 'none')

          playerG.append('circle')
            .datum(arena).attr('class', 'arena-dot')
            .attr('cx', proj[0]).attr('cy', proj[1]).attr('r', 6)
            .attr('fill', CH_RED).attr('stroke', '#ffffff').attr('stroke-width', 1.5)
            .attr('pointer-events', 'none')
        }
      }
    }

    // ── Drag — pan (translate) the flat map ──────────────────────────────────
    let lastPos = null
    let rafId   = null

    function scheduleRedraw() {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        redrawStatic()
        redrawPositions()
        rafId = null
      })
    }

    svg.call(
      d3.drag()
        // Ignore multi-touch so pinch-to-zoom doesn't also pan
        .filter(event => !event.touches || event.touches.length === 1)
        .on('start', (event) => { lastPos = [event.x, event.y] })
        .on('drag', (event) => {
          if (!lastPos) return
          const t = projection.translate()
          projection.translate([
            t[0] + (event.x - lastPos[0]),
            t[1] + (event.y - lastPos[1]),
          ])
          lastPos = [event.x, event.y]
          scheduleRedraw()
        })
        .on('end', () => { lastPos = null })
    )

    // ── Pinch-to-zoom for touch devices ─────────────────────────────────────
    // Uses native addEventListener (not d3.on) so we can pass { passive: false }
    // which is required to call event.preventDefault() and stop page scroll.
    let pinchDist  = null
    let pinchScale = null

    function onTouchStart(event) {
      if (event.touches.length === 2) {
        event.preventDefault()
        const [t0, t1] = event.touches
        pinchDist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
        pinchScale = projection.scale()
      }
    }

    function onTouchMove(event) {
      if (event.touches.length === 2 && pinchDist !== null) {
        event.preventDefault()
        const [t0, t1] = event.touches
        const dist   = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
        const factor = dist / pinchDist
        const ns     = Math.max(initialScale * 0.5, Math.min(100000, pinchScale * factor))

        // Zoom toward the midpoint between the two fingers
        const rect = svgEl.getBoundingClientRect()
        const mx   = (t0.clientX + t1.clientX) / 2 - rect.left
        const my   = (t0.clientY + t1.clientY) / 2 - rect.top

        const p = projection.invert([mx, my])
        projection.scale(ns)
        if (p) {
          const np = projection(p)
          const t  = projection.translate()
          projection.translate([t[0] + mx - np[0], t[1] + my - np[1]])
        }
        scheduleRedraw()
      }
    }

    function onTouchEnd() { pinchDist = pinchScale = null }

    svgEl.addEventListener('touchstart',  onTouchStart, { passive: false })
    svgEl.addEventListener('touchmove',   onTouchMove,  { passive: false })
    svgEl.addEventListener('touchend',    onTouchEnd)
    svgEl.addEventListener('touchcancel', onTouchEnd)

    // Click on map background dismisses pinned tooltip
    svg.on('click', () => forceHideTooltip())

    // ── Scroll zoom — zoom toward the cursor position ────────────────────────
    svg.on('wheel', (event) => {
      event.preventDefault()

      // Normalise delta across mouse wheels (deltaMode 0=px, 1=lines, 2=pages)
      const rawDelta = event.deltaMode === 1 ? event.deltaY * 30
                     : event.deltaMode === 2 ? event.deltaY * 300
                     : event.deltaY
      // Proportional factor: smooth on trackpads, snappy on wheels
      const factor = Math.pow(0.999, rawDelta)
      const scale  = projection.scale()
      const ns     = Math.max(initialScale * 0.5, Math.min(100000, scale * factor))

      // Zoom toward the cursor
      const [mx, my] = d3.pointer(event)
      const p = projection.invert([mx, my])
      projection.scale(ns)
      if (p) {
        const np = projection(p)
        const t  = projection.translate()
        projection.translate([t[0] + mx - np[0], t[1] + my - np[1]])
      }

      scheduleRedraw()
    })

    // ── Load data ────────────────────────────────────────────────────────────
    Promise.all([
      d3.json(WORLD_URL),
      d3.json(LAKES_URL).catch(() => null),        // graceful fallback if unavailable
      d3.json(SUBNATIONAL_URL).catch(() => null),  // graceful fallback if unavailable
      d3.csv(PLAYERS_URL),
      d3.csv(ARENAS_URL),
    ])
      .then(([world, lakes, subnational, players, arenas]) => {
        landPath.datum(topojson.feature(world, world.objects.countries)).attr('d', geoPath)
        borderPath.datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b)).attr('d', geoPath)

        if (lakes) lakesPath.datum(lakes).attr('d', geoPath)

        if (subnational) {
          const usCanada = {
            type: 'FeatureCollection',
            features: subnational.features.filter(
              f => f.properties.iso_a2 === 'US' || f.properties.iso_a2 === 'CA'
            ),
          }
          subnatPath.datum(usCanada).attr('d', geoPath)
        }

        // Pre-compute career totals for every player (done once at load time)
        const grouped = new Map()
        for (const p of players) {
          if (!grouped.has(p.player_id)) grouped.set(p.player_id, [])
          grouped.get(p.player_id).push(p)
        }
        const totalsMap = new Map()
        for (const [pid, rows] of grouped) totalsMap.set(pid, buildCareerTotals(rows))
        careerTotalsRef.current = totalsMap

        const uniqueSeasons = [...new Set(players.map(p => p.season))].sort()
        setSeasons(uniqueSeasons)
        setLoading(false)

        updateRef.current = (season) => {
          currentSeasonRef.current = season
          updateSeason(season, players, arenas, setPlayerCount)
        }

        updateSeason('all', players, arenas, setPlayerCount)
      })
      .catch(err => {
        console.error(err)
        setError('Failed to load data. Make sure the dev server is running.')
        setLoading(false)
      })

    return () => {
      svg.selectAll('*').remove()
      svgEl.removeEventListener('touchstart',  onTouchStart)
      svgEl.removeEventListener('touchmove',   onTouchMove)
      svgEl.removeEventListener('touchend',    onTouchEnd)
      svgEl.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  // ── Season button click ───────────────────────────────────────────────────
  const handleSeason = (season) => {
    setActiveSeason(season)
    setSeasonLabel(season === 'all' ? 'All seasons' : longSeason(season))
    updateRef.current?.(season)
  }

  const timelineRef = useRef(null)
  useEffect(() => {
    timelineRef.current?.querySelector('.season-btn.active')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeSeason])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="globe-wrapper">

      <header className="globe-header">
        <img
          className="globe-logo"
          src={`${import.meta.env.BASE_URL}Logo_Canadiens_de_Montr%C3%A9al_1926-1952.svg`}
          alt="Canadiens de Montréal crest"
        />
        <div className="globe-header-text">
          <h1>Montréal Canadiens</h1>
          <p>Every player to wear the bleu‑blanc‑rouge — mapped from birthplace to home arena</p>
        </div>
      </header>

      <div className="timeline-wrapper">
        {loading && <span className="loading-msg">Loading…</span>}
        {error   && <span className="error-msg">{error}</span>}
        <div className="timeline" ref={timelineRef}>
          <button
            className={`season-btn all-btn${activeSeason === 'all' ? ' active' : ''}`}
            onClick={() => handleSeason('all')}
          >All</button>

          {seasons.map((season, i) => {
            const year    = parseInt(String(season).substring(0, 4))
            const isCup   = CUP_WINS.has(String(season))
            return (
              <span key={season} style={{ display: 'contents' }}>
                {(i === 0 || year % 10 === 0) && (
                  <span className="decade-sep">{Math.floor(year / 10) * 10}s</span>
                )}
                <span className="season-cell">
                  <button
                    className={`season-btn${activeSeason === season ? ' active' : ''}`}
                    title={longSeason(season)}
                    onClick={() => handleSeason(season)}
                  >
                    {shortSeason(season)}
                  </button>
                  {isCup && (
                    <img
                      src={`${import.meta.env.BASE_URL}banner-habs-cropped.svg`}
                      className="cup-banner"
                      alt="Stanley Cup"
                      title={`${longSeason(season)} Stanley Cup Champions`}
                    />
                  )}
                </span>
              </span>
            )
          })}
          <button
            className={`season-btn all-btn${activeSeason === 'all' ? ' active' : ''}`}
            onClick={() => handleSeason('all')}
          >All</button>
        </div>
      </div>

      <div className="globe-container" ref={containerRef}>
        <svg ref={svgRef} className="globe-svg" />
      </div>

      <div className="info-bar">
        <span className="season-label-text">{seasonLabel}</span>
        <span className="sep">·</span>
        <span className="count" style={{ color: CH_RED }}>{playerCount}</span>
        <span> players shown</span>
        <span className="sep">·</span>
        <span className="hint">Drag to pan &nbsp;·&nbsp; Scroll to zoom</span>
      </div>

      <div className="tooltip" ref={tooltipRef} />

      <PlayerPanel
        data={selectedPlayer}
        onClose={() => setSelectedPlayer(null)}
      />

    </div>
  )
}
