'use client';

import { useMemo, useState } from 'react';

type Locale = 'en' | 'ja';
type AreaKey = 'kesennuma' | 'owase' | 'shima';

const areaData = {
  kesennuma: { name: { en: 'Kesennuma Bay', ja: '気仙沼湾' }, code: 'KS', risk: 'HIGH', temp: '24.8°', delta: '+1.7°', chlorophyll: '8.4', exposure: '36', confidence: '91%', policy: 'AS-KS-2041', stations: [['Farm K-03','High'],['Buoy KS-02','Normal'],['Farm K-11','Watch']] },
  owase: { name: { en: 'Owase Bay', ja: '尾鷲湾' }, code: 'OW', risk: 'WATCH', temp: '26.1°', delta: '+0.9°', chlorophyll: '5.9', exposure: '18', confidence: '88%', policy: 'AS-OW-1187', stations: [['Farm O-08','Watch'],['Buoy OW-01','Normal'],['Farm O-14','Normal']] },
  shima: { name: { en: 'Shima Peninsula', ja: '志摩半島' }, code: 'SH', risk: 'LOW', temp: '25.3°', delta: '+0.4°', chlorophyll: '3.2', exposure: '4', confidence: '94%', policy: 'AS-SH-3308', stations: [['Farm S-12','Normal'],['Buoy SH-04','Normal'],['Farm S-18','Normal']] },
} as const;

const copy = {
  en: { overview:'Monitoring overview', headline:'Early warning, clearer action.', area:'Monitored area', overall:'Overall risk', sea:'Sea temperature', chl:'Chlorophyll-a', exposure:'7-day exposure', confidence:'Model confidence', seasonal:'vs. seasonal baseline', threshold:'Above alert threshold', hours:'High-risk conditions', source:'Satellite + buoy data', map:'Satellite risk map', risk:'Risk', temp:'Temp', active:'Active alert', alert:'Harmful algae risk rising', why:'Why this alert', rationale:'Chlorophyll-a has remained above 7.5 µg/L for 6 hours while surface temperature is above baseline.', recommended:'Recommended action', action:'Pause feeding at the affected farm. Inspect fish behavior and prepare aeration equipment before 16:00.', acknowledge:'Acknowledge & record', issued:'Issued 12:42', policy:'Parametric policy', activePolicy:'Coverage active', trigger:'Trigger threshold', triggerText:'Chlorophyll-a ≥ 10 µg/L for 12 consecutive hours', payout:'Covered payout', payoutText:'¥8.0M maximum', insurance:'Payouts apply to covered losses when the agreed environmental trigger is met.', outlook:'72-hour outlook', stations:'Farm & station status', events:'Recent events', noAlert:'Conditions remain within operating thresholds.', normalAction:'Continue standard monitoring and feeding schedule.', acknowledged:'Alert acknowledged', recorded:'Response recorded in event log.' },
  ja: { overview:'モニタリング概要', headline:'早期発見、早期対応。', area:'監視エリア', overall:'総合リスク', sea:'海水温', chl:'クロロフィルa', exposure:'過去7日間の曝露', confidence:'モデル信頼度', seasonal:'平年値との差', threshold:'警戒基準を超えています', hours:'高リスク環境の継続時間', source:'衛星・観測ブイ統合データ', map:'衛星リスクマップ', risk:'リスク', temp:'水温', active:'発令中の警報', alert:'有害藻類の発生リスクが上昇', why:'この警報が出た理由', rationale:'クロロフィルa濃度が6時間連続で7.5 µg/Lを超え、表層水温も平年値を上回っています。', recommended:'推奨される対応', action:'対象の養殖場では給餌を一時停止してください。魚の様子を確認し、16時までに曝気設備を使用できる状態にしてください。', acknowledge:'確認して記録する', issued:'12:42に発令', policy:'パラメトリック保険', activePolicy:'補償期間中', trigger:'支払条件', triggerText:'クロロフィルa濃度が12時間連続で10 µg/L以上', payout:'支払限度額', payoutText:'最大800万円', insurance:'合意された環境条件を満たした場合、補償対象となる損失に対して保険金が支払われます。', outlook:'今後72時間の予測', stations:'養殖場・観測局の状況', events:'最近の記録', noAlert:'現在、各指標は通常の操業基準内です。', normalAction:'通常どおり監視と給餌を続けてください。', acknowledged:'警報を確認しました', recorded:'対応内容を記録しました。' },
};

export default function Home() {
  const [locale, setLocale] = useState<Locale>('en');
  const [areaKey, setAreaKey] = useState<AreaKey>('kesennuma');
  const [layer, setLayer] = useState('risk');
  const [acknowledged, setAcknowledged] = useState(false);
  const t = copy[locale];
  const area = areaData[areaKey];
  const risky = area.risk !== 'LOW';
  const riskLabel = locale === 'ja' ? ({ HIGH:'高', WATCH:'注意', LOW:'低' } as const)[area.risk] : area.risk;
  const statusLabel = (status: string) => locale === 'ja' ? ({ High:'高リスク', Watch:'要注意', Normal:'正常' } as Record<string,string>)[status] : status;
  const events = useMemo(() => [
    ...(acknowledged ? [{ time:'13:06', icon:'✓', title:t.acknowledged, text:t.recorded }] : []),
    { time:'12:42', icon:'!', title: locale === 'en' ? 'High-risk alert issued' : '高リスク警報を発令しました', text: `${area.name[locale]} · ${area.chlorophyll} µg/L` },
    { time:'11:30', icon:'↗', title: locale === 'en' ? 'Forecast updated' : '予測を更新しました', text: locale === 'en' ? 'Satellite pass + buoy ingest complete' : '衛星・観測ブイのデータ取得が完了' },
    { time:'09:15', icon:'•', title: locale === 'en' ? 'Daily policy check' : '保険状況を確認しました', text: locale === 'en' ? 'Coverage active · no trigger' : '補償期間中・支払条件には未到達' },
  ], [acknowledged, area, locale, t]);

  const switchArea = (key: AreaKey) => { setAreaKey(key); setAcknowledged(false); };

  return (
    <main className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">A</span><div><strong>AquaSure</strong><small>COMMAND</small></div></div><div className="live-pill"><span/> {locale === 'en' ? 'LIVE · updated 2 min ago' : '稼働中・2分前に更新'}</div><button className="lang-button" onClick={() => setLocale(locale === 'en' ? 'ja' : 'en')} type="button" aria-label="Switch language">{locale === 'en' ? '日本語' : 'English'} <span>／ {locale.toUpperCase()}</span></button></header>
      <section className="content">
        <div className="page-heading"><div><p className="eyebrow">{t.overview}</p><h1>{t.headline}</h1></div><label className="area-select"><span>{t.area}</span><select value={areaKey} onChange={(e) => switchArea(e.target.value as AreaKey)}>{Object.entries(areaData).map(([key,item]) => <option key={key} value={key}>{item.name.en} / {item.name.ja}</option>)}</select></label></div>
        <div className="metric-grid">
          <Metric dark label={t.overall} jp="総合リスク" value={riskLabel} sub={risky ? (locale==='en'?'Elevated HAB conditions':'有害藻類の発生条件が強まっています') : t.noAlert}/>
          <Metric label={t.sea} jp="海水温" value={area.temp} accent={area.delta} sub={t.seasonal}/><Metric label={t.chl} jp="クロロフィルa" value={area.chlorophyll} unit="µg/L" sub={t.threshold}/><Metric label={t.exposure} jp="過去7日間の曝露" value={area.exposure} unit={locale==='en'?'hrs':'時間'} sub={t.hours}/><Metric label={t.confidence} jp="モデル信頼度" value={area.confidence} sub={t.source}/>
        </div>
        <div className="primary-grid">
          <section className="map-card"><div className="panel-head"><div><p className="eyebrow">{t.map}</p><h2>{area.name.en} / {area.name.ja}</h2></div><div className="map-layers">{['risk','temp','chl-a'].map(item => <button key={item} className={layer===item?'active':''} onClick={() => setLayer(item)}>{item==='risk'?t.risk:item==='temp'?t.temp:locale==='en'?'Chl-a':'クロロフィルa'}</button>)}</div></div><div className={`map-visual layer-${layer}`}><div className="coast coast-a"/><div className="coast coast-b"/><div className="heat heat-a"/><div className="heat heat-b"/>{area.stations.map((station,index)=><div className={`station station-${['a','b','c'][index]}`} key={station[0]}>{station[1]==='High'?<span>!</span>:<i className={station[1]==='Watch'?'watch':''}/>}<label>{station[0]}<br/><b>{statusLabel(station[1])}</b></label></div>)}<div className="map-key"><span><i className="low"/>{locale==='en'?'Low':'低'}</span><span><i className="medium"/>{locale==='en'?'Watch':'注意'}</span><span><i className="high"/>{locale==='en'?'High':'高'}</span></div></div></section>
          <aside className={`alert-card ${acknowledged?'is-acknowledged':''}`}><div className="alert-top"><span className="alert-icon">{acknowledged?'✓':'!'}</span><div><p className="eyebrow">{acknowledged?t.acknowledged:`${t.active} · ${riskLabel}`}</p><h2>{risky?t.alert:t.noAlert}</h2></div></div><div className="alert-block"><span>{t.why}</span><p>{risky?t.rationale:t.noAlert}</p></div><div className="alert-block action"><span>{t.recommended}</span><p>{risky?t.action:t.normalAction}</p></div><button className="ack-button" onClick={()=>setAcknowledged(true)} disabled={acknowledged} type="button">{acknowledged?t.recorded:t.acknowledge}<span>{acknowledged?'✓':'→'}</span></button><small className="updated">{t.issued} · {t.confidence} {area.confidence}</small></aside>
        </div>
        <div className="lower-grid">
          <section className="info-card policy-card"><div className="section-title"><div><p className="eyebrow">{t.policy}</p><h2>{area.policy}</h2></div><span className="status-chip">● {t.activePolicy}</span></div><div className="policy-details"><div><span>{t.trigger}</span><strong>{t.triggerText}</strong></div><div><span>{t.payout}</span><strong>{t.payoutText}</strong></div></div><p className="insurance-copy">{t.insurance}</p></section>
          <section className="info-card outlook-card"><div className="section-title"><div><p className="eyebrow">{t.outlook}</p><h2>{locale==='en'?'Conditions trend':'環境リスクの推移'}</h2></div><span className="trend">↗ {risky?'18%':'4%'}</span></div><div className="chart"><div className="threshold-line"><span>{locale==='en'?'trigger':'支払条件'}</span></div><div className="chart-fill"/><svg viewBox="0 0 500 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,78 70,74 140,70 215,60 285,63 360,45 430,31 500,19"/></svg><div className="chart-labels"><span>{locale==='en'?'NOW':'現在'}</span><span>{locale==='en'?'+24H':'24時間後'}</span><span>{locale==='en'?'+48H':'48時間後'}</span><span>{locale==='en'?'+72H':'72時間後'}</span></div></div></section>
          <section className="info-card station-card"><div className="section-title"><div><p className="eyebrow">{t.stations}</p><h2>{area.name[locale]}</h2></div><span className="station-count">{locale==='en'?'3 online':'3地点 稼働中'}</span></div><div className="station-list">{area.stations.map((s,index)=><div key={s[0]}><span className={`status-dot ${s[1].toLowerCase()}`}/><div><strong>{s[0]}</strong><small>{index===1?(locale==='en'?'Sensor buoy':'観測ブイ'):(locale==='en'?'Sea farm':'養殖場')}</small></div><b>{statusLabel(s[1])}</b></div>)}</div></section>
        </div>
        <section className="event-card"><div className="section-title"><div><p className="eyebrow">{t.events}</p><h2>{locale==='en'?'Operational record':'対応履歴'}</h2></div><span className="audit">{locale==='en'?'AUDIT READY':'監査記録対応'}</span></div><div className="event-list">{events.map((event,index)=><div className="event-row" key={`${event.time}-${index}`}><time>{event.time}</time><span className="event-icon">{event.icon}</span><div><strong>{event.title}</strong><small>{event.text}</small></div></div>)}</div></section>
      </section>
    </main>
  );
}

function Metric({dark,label,jp,value,unit,accent,sub}:{dark?:boolean,label:string,jp:string,value:string,unit?:string,accent?:string,sub:string}){return <article className={`metric-card ${dark?'risk':''}`}><div className="metric-label">{label}<span>{jp}</span></div><div className="metric-main"><strong>{value}</strong>{unit&&<small>{unit}</small>}{accent&&<small>{accent}</small>}{dark&&<span className="risk-dot"/>}</div><p>{sub}</p></article>}
