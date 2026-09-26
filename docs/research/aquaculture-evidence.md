# Aquaculture evidence and research limits

Research retained for [#36](https://github.com/reeldeal-xyz/reeldeal/issues/36)
and [#47](https://github.com/reeldeal-xyz/reeldeal/issues/47), reviewed
2026-09-26. Product scope and integration are in the [HMI handoff](../HMI-HANDOFF.md).
These sources support specific observations; they do not validate farm-loss
predictions or a relief entitlement.

## Restriction replay

The [Miyagi report dated 2026-09-15](https://www.pref.miyagi.jp/documents/24934/080915_mahikeika.pdf)
records Karakuwa east scallop restriction starting May 12 and released September
15. Pinned PDF SHA-256:
`39851aa6b573d9a4491f48fb2595609ffb07f84ac4a42000ab81fb1c4563d708`.
Use the [official index](https://www.pref.miyagi.jp/soshiki/suikisei/kaidoku.html)
for later reports. This episode is historical, not an active restriction claim.

出荷自主規制 is a shipping restriction. Preserve species, monitoring area, toxin,
effective dates and censored measurements such as `<1.9`. Inferred continuity
does not create measured weekly toxin values. Chlorophyll alone does not establish
toxin status, stock mortality or a farm's yen loss.

The retained `web/src/fixtures/banweeks.ts` reaches four weekly checkpoints on
June 2 from May 12: **21 elapsed days**, not 28. A 28-day wait completes June 9.
#55/#64 must select and version the policy before #80's real restriction response
can satisfy #36. A retrospective report also cannot prove that a decision was
possible from information available on the original event date.

Keep historical dates, payout season, signature deadline and deployment distinct.
The old June fixture's 90-day deadline has expired; an authorized replay requires
an explicit valid signing deadline without rewriting the observation history.

## Plot records and environmental support

[plot-registration-snapshot.json](plot-registration-snapshot.json) extracts 15
archived Sepolia registrations from commit `64fe5b7`: eight scallop, four hoya and
three oyster plots. Its source path/hash and successful receipt references are
included. Farmer wallets and seed areas are omitted. It is an archival evidence
extract, not the live plot inventory or a runtime input. Current enrollment,
beneficiary association and balances were not queried.

Null geometry describes that snapshot. Merged #112 now adds matching-ID synthetic
geometry at `pipeline/data/ref/plots.geojson`; it is not surveyed farm geometry.
Preserve `source: demo`, use canonical IDs, and obtain current inventory from the
agreed #59/#79 interface. Existing `umi.eth` names are historical identifiers;
the ReelDeal rebrand does not rename registered ENS records.

Q10 in [the pipeline specification](../../pipeline/README.md) now defines daily
JAXA fallback and aggregation. Retain product, masks, extraction strategy/distance,
time and missingness. The old one-asset JAXA check is superseded by #112's broader
ingestion; do not present it as the current archive's extent. A monthly composite
is not a sequence of independent daily observations. The pinned Futatsune buoy
series measures at 3 m and has a 29 h 15 m 38 s gap on September 17–18; it is not
equivalent to an offshore surface pixel or a water-column profile.

## Species and combined factors — validation gates

| Source | Supported use | Limit |
|---|---|---|
| [Scallop thermal tolerance](https://link.springer.com/article/10.1007/s10499-014-9788-0) | Acute/acclimated experimental context | Abstract reviewed; full coefficients not obtained |
| [Hoya temperature/size experiment](https://e-kfas.org/Upload/files/kfas/8.%20449-454%20vol%2055%20No.%204.pdf) | Respiration response | Not a mortality curve |
| [Hoya hypoxia experiment](https://www.ebr.or.kr/journal/article.php?code=14486) | Separate oxygen-response evidence | Cannot infer a joint temperature–oxygen model |
| [Oyster temperature/salinity/density experiment](https://scxy.ouc.edu.cn/_upload/article/files/8e/ea/945b3044409584b1eb630a4b596f/f1212fef-b276-4846-8783-db9e49aa7e48.pdf) | Larval response within tested conditions | Not validated for adult Miyagi farms |

Before plotting a curve, record taxon, life stage, size, exposure duration,
endpoint, tested range, observations and uncertainty. Keep profile, model and
payout-rule versions separate. For compatible survival endpoints and a matched
nonzero control, `S_AB = S_A × S_B / S_0` is an independent multiplicative
expectation, not demonstrated synergy. Joint-exposure data is needed to estimate
interactions ([methods reference](https://pmc.ncbi.nlm.nih.gov/articles/PMC12340609/)).
Do not multiply raw units, ordinal risk scores or duplicated correlated indices.
Layer visibility toggles do not alter the model; changed inputs require an
explicit scenario.

## Storm comparison and operator validation

Previously inspected [No.26](https://www.data.jma.go.jp/developer/xml/data/20260926064010_0_VPTW61_010000.xml)
and [No.25](https://www.data.jma.go.jp/developer/xml/data/20260919094048_0_VPTW60_010000.xml)
are dated JMA issuances, not a complete finalized historical archive. Preserve
issuance/valid times and revisions under [JMA retention guidance](https://xml.kishou.go.jp/xmlpull.html).
Track proximity alone cannot predict farm wave damage or crop mortality.

Production 2D/3D requires a named farmer/science task with reviewed geometry, supported
marine fields and matched map/chart values. Keep Japan/local bounds, time/depth,
missingness and uncertainty visible, with a usable 2D/list fallback. A named
operator/designer review and local validation remain outstanding.

[COAST](https://www.ccrif.org/projects/coast/coast-faqs) informs registry,
verification and distribution workflow; it is sovereign insurance, not the same
fund model. [Japan's existing fisheries support](https://www.jfa.maff.go.jp/j/kikaku/syotoku_hosyo/)
also matters. The proposed supplementary fund still needs grower/co-op validation
of need, allocation fairness and real-pilot treatment.
