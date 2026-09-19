// /api/price?code=360750&from=20230101&to=20260918
// 금융위원회_주식시세정보 (공공데이터포털) 프록시
// - code: 종목 단축코드 6자리 (예: 360750, 0174B0)
// - from, to: YYYYMMDD (생략 시 최근 1건만 조회)
//
// 공공데이터 특성상 실시간이 아니라 "영업일 기준 하루 뒤 오후 1시 이후" 갱신됩니다.
// 즉 오늘 조회해도 최신값은 "어제(또는 그 이전 영업일) 종가"입니다.

const API_BASE = "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");

  const { code, from, to } = req.query;
  if (!code || typeof code !== "string" || code.length !== 6) {
    return res.status(400).json({ error: "code(종목코드 6자리)가 필요합니다." });
  }

  const serviceKey = process.env.DATA_GO_KR_KEY;
  if (!serviceKey) {
    return res.status(500).json({
      error: "서버에 DATA_GO_KR_KEY 환경변수가 설정되어 있지 않습니다. Vercel 프로젝트 설정 > Environment Variables 에서 추가하고 재배포하세요.",
    });
  }

  const isRange = Boolean(from && to);
  const params = new URLSearchParams({
    serviceKey,
    resultType: "json",
    numOfRows: isRange ? "2000" : "5",
    pageNo: "1",
    srtnCd: code,
  });
  if (from) params.set("beginBasDt", from);
  if (to) params.set("endBasDt", to);

  try {
    const upstream = await fetch(`${API_BASE}?${params.toString()}`);
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({ error: "공공데이터포털 응답을 해석할 수 없습니다.", raw: text.slice(0, 500) });
    }

    const header = data?.response?.header;
    if (header && header.resultCode !== "00") {
      return res.status(502).json({ error: `공공데이터포털 오류: ${header.resultMsg || header.resultCode}` });
    }

    const items = data?.response?.body?.items?.item;
    const arr = Array.isArray(items) ? items : items ? [items] : [];

    const rows = arr
      .map((it) => ({
        date: it.basDt, // YYYYMMDD
        name: it.itmsNm,
        close: Number(it.clpr),
        open: Number(it.mkp),
        high: Number(it.hipr),
        low: Number(it.lopr),
        volume: Number(it.trqu),
      }))
      .filter((r) => r.date && !isNaN(r.close))
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({
      code,
      name: rows.length ? rows[rows.length - 1].name : null,
      latest: rows.length ? rows[rows.length - 1] : null,
      rows,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
