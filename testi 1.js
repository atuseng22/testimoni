/* =========================================================================
   FDC — PROXY MINIMAL
   Satu berkas pendek. Tugasnya cuma satu: meneruskan permintaan dari
   aplikasi ke sumber data, lalu mengembalikan jawabannya dengan izin
   lintas-asal. Ini menghapus seluruh ketergantungan pada gerbang gratis.

   ── CARA PASANG, SEKITAR TIGA MENIT ─────────────────────────────────────

   1. Buka dash.cloudflare.com, daftar akun gratis.
   2. Menu kiri → Compute (Workers) → Create → Start with Hello World →
      beri nama, misalnya "fdc-proxy" → Deploy.
   3. Klik "Edit code". Hapus semua isi editor, tempel seluruh berkas ini,
      lalu klik "Deploy" lagi.
   4. Salin alamat worker Anda, bentuknya seperti:
         https://fdc-proxy.nama-anda.workers.dev
   5. Buka aplikasi FDC → ikon gerigi → gulir ke bawah →
      tempel alamat itu di kotak "Sambungkan server sendiri" → tekan tombolnya.

   Selesai. Seluruh data akan mengalir lewat jalur ini.

   ── UJI CEPAT ───────────────────────────────────────────────────────────
   Buka di peramban:
     https://alamat-worker-anda/pasar?range=5d&interval=1d
   Kalau muncul tumpukan JSON berisi angka, berarti sudah jalan.
   ========================================================================= */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

/* Hanya alamat di daftar ini yang boleh diteruskan, supaya worker Anda
   tidak dipakai orang lain sebagai proxy sembarangan. */
const DIIZINKAN = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'www.cnbcindonesia.com',
  'rss.kontan.co.id',
  'market.bisnis.com',
  'www.antaranews.com',
  'www.cnnindonesia.com',
  'feed.liputan6.com',
  'rss.tempo.co',
  'www.idx.co.id',
  'www.seputarforex.org',
  'raw.githubusercontent.com'
];

function bolehkah(alamat){
  try{ return DIIZINKAN.includes(new URL(alamat).hostname); }
  catch(e){ return false; }
}

async function teruskan(alamat, tipe){
  const r = await fetch(alamat, {
    cf: { cacheTtl: 45, cacheEverything: true },
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; FDC/1.0)',
      accept: tipe === 'teks' ? 'text/html,application/xml,*/*' : 'application/json'
    }
  });
  const isi = await r.text();
  return new Response(isi, {
    status: r.status,
    headers: {
      ...CORS,
      'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=45'
    }
  });
}

const YAHOO = 'https://query1.finance.yahoo.com';

export default {
  async fetch(request){
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const jalur = url.pathname.replace(/\/+$/, '');
    const q = url.searchParams;
    const balas = (isi, kode) => new Response(JSON.stringify(isi), {
      status: kode || 200,
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' }
    });

    try{
      /* ---- indeks IHSG ---- */
      if (jalur.endsWith('/pasar')){
        return teruskan(YAHOO + '/v8/finance/chart/%5EJKSE?range=' +
          (q.get('range') || '1d') + '&interval=' + (q.get('interval') || '5m'));
      }

      /* ---- satu simbol apa pun: saham, kripto, mata uang ---- */
      if (jalur.endsWith('/kutipan')){
        const sym = q.get('sym') || 'BBCA.JK';
        return teruskan(YAHOO + '/v8/finance/chart/' + encodeURIComponent(sym) +
          '?range=' + (q.get('range') || '5d') +
          '&interval=' + (q.get('interval') || '1d') +
          (q.get('events') ? '&events=' + q.get('events') : ''));
      }

      /* ---- banyak simbol sekaligus ---- */
      if (jalur.endsWith('/banyak')){
        const daftar = (q.get('sym') || '').split(',').filter(Boolean).slice(0, 40);
        if (!daftar.length) return balas({ galat: 'sym kosong' }, 400);

        const hasil = {};
        for (let i = 0; i < daftar.length; i += 8){
          const kloter = daftar.slice(i, i + 8);
          await Promise.all(kloter.map(async sym => {
            try{
              const r = await fetch(YAHOO + '/v8/finance/chart/' + encodeURIComponent(sym) +
                '?range=5d&interval=1d', {
                cf: { cacheTtl: 45, cacheEverything: true },
                headers: { 'user-agent': 'Mozilla/5.0 (compatible; FDC/1.0)' }
              });
              if (!r.ok) return;
              const j = await r.json();
              const res = j.chart && j.chart.result && j.chart.result[0];
              if (!res) return;
              const tutup = ((res.indicators.quote[0] || {}).close || []).filter(x => x != null);
              if (!tutup.length) return;
              const kunci = sym.replace('.JK', '').replace('=X', '').replace('-USD', '');
              hasil[kunci] = {
                close: tutup,
                previousClose: res.meta ? res.meta.chartPreviousClose : null,
                harga: res.meta ? res.meta.regularMarketPrice : tutup[tutup.length - 1]
              };
            }catch(e){}
          }));
        }
        return balas(hasil);
      }

      /* ---- laporan keuangan ---- */
      if (jalur.endsWith('/fundamental')){
        const sym = (q.get('sym') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        const jenis = ['quarterlyTotalRevenue','quarterlyNetIncome','quarterlyGrossProfit',
          'quarterlyOperatingIncome','quarterlyTotalAssets',
          'quarterlyTotalLiabilitiesNetMinorityInterest','quarterlyStockholdersEquity',
          'quarterlyOperatingCashFlow','quarterlyInvestingCashFlow',
          'quarterlyFinancingCashFlow','quarterlyFreeCashFlow'].join(',');
        const akhir = Math.floor(Date.now() / 1000);
        return teruskan(YAHOO + '/ws/fundamentals-timeseries/v1/finance/timeseries/' +
          sym + '.JK?symbol=' + sym + '.JK&type=' + jenis +
          '&period1=' + (akhir - 126144000) + '&period2=' + akhir);
      }

      /* ---- profil perusahaan ---- */
      if (jalur.endsWith('/profil')){
        const sym = (q.get('sym') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        return teruskan(YAHOO + '/v10/finance/quoteSummary/' + sym +
          '.JK?modules=assetProfile,summaryProfile,price,financialData,defaultKeyStatistics');
      }

      /* ---- berita dari kanal media ---- */
      if (jalur.endsWith('/berita')){
        const kanal = [
          ['cnbc', 'https://www.cnbcindonesia.com/market/rss'],
          ['kontan', 'https://rss.kontan.co.id/news/investasi'],
          ['bisnis', 'https://market.bisnis.com/rss'],
          ['antara', 'https://www.antaranews.com/rss/ekonomi.xml'],
          ['cnn', 'https://www.cnnindonesia.com/ekonomi/rss'],
          ['liputan6', 'https://feed.liputan6.com/rss/bisnis'],
          ['tempo', 'https://rss.tempo.co/bisnis']
        ];

        const bersih = t => String(t || '')
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ').trim();

        const semua = [];
        await Promise.all(kanal.map(async ([id, alamat]) => {
          try{
            const r = await fetch(alamat, {
              cf: { cacheTtl: 240, cacheEverything: true },
              headers: { 'user-agent': 'Mozilla/5.0 (compatible; FDC/1.0)' }
            });
            if (!r.ok) return;
            const xml = await r.text();
            const butir = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
            for (const p of butir.slice(0, 20)){
              const tag = n => {
                const m = p.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)<\\/' + n + '>', 'i'));
                return m ? bersih(m[1]) : '';
              };
              const judul = tag('title');
              const tautan = tag('link').replace(/\/amp\/?$/, '');
              if (!judul || !/^https?:/.test(tautan)) continue;
              const waktu = tag('pubDate');
              const t = waktu ? new Date(waktu) : new Date();
              semua.push({
                id: tautan, title: judul, url: tautan, source: id,
                publishedAt: isNaN(t) ? new Date().toISOString() : t.toISOString()
              });
            }
          }catch(e){}
        }));

        semua.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
        return balas(semua.slice(0, 60));
      }

      /* ---- daftar emiten ---- */
      if (jalur.endsWith('/emiten')){
        try{
          const r = await fetch('https://www.seputarforex.org/saham/daftar_emiten', {
            cf: { cacheTtl: 21600, cacheEverything: true },
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; FDC/1.0)' }
          });
          if (r.ok){
            const html = await r.text();
            const baris = html.split(/<tr[\s>]/i);
            const data = [], lihat = {};
            for (let i = 1; i < baris.length; i++){
              const mk = baris[i].match(/harga\.php\?kode=([a-zA-Z]{3,5})\b/);
              if (!mk) continue;
              const kode = mk[1].toUpperCase();
              if (lihat[kode]) continue;
              lihat[kode] = 1;
              const delist = /kode=delisting/i.test(baris[i]);
              const sel = baris[i].split(/<\/td>/i).map(x =>
                x.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
              let nama = kode;
              for (const isi of sel){
                if (!isi || isi === kode || /^\d+$/.test(isi) || isi.length < 3) continue;
                if (/^(ENERGY|FINANCIALS|PROPERTY|TECHNOLOGY|HEALTHCARE|INDUSTRIALS|TRANSPORTATION|INFRASTRUCTURE|DELISTING)/i.test(isi)) continue;
                nama = isi; break;
              }
              data.push({ Code: kode, Name: nama, Status: delist ? 'Delisting' : 'Aktif' });
            }
            if (data.length > 100) return balas({ data });
          }
        }catch(e){}
        return balas({ data: [] }, 502);
      }

      /* ---- alamat bebas, hanya untuk yang ada di daftar izin ---- */
      if (jalur.endsWith('/ambil')){
        const alamat = q.get('url') || '';
        if (!bolehkah(alamat)) return balas({ galat: 'alamat tidak diizinkan' }, 403);
        return teruskan(alamat, 'teks');
      }

      /* ---- pemeriksa kesehatan ---- */
      return balas({
        nama: 'FDC proxy',
        siap: true,
        jalur: ['/pasar', '/kutipan', '/banyak', '/fundamental', '/profil', '/berita', '/emiten', '/ambil'],
        waktu: new Date().toISOString()
      });

    }catch(e){
      return balas({ galat: String(e) }, 500);
    }
  }
};
