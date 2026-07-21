// Real sector ETFs — the standard, widely-used proxies for each sector's daily
// performance. Shared between narrative.js (Sector Momentum / Performance) and
// alerts.js (Sector Impact alerts) so both use the exact same real data source.

const SECTOR_ETFS = [
  { sector: 'Technology', symbol: 'XLK' },
  { sector: 'Financials', symbol: 'XLF' },
  { sector: 'Energy', symbol: 'XLE' },
  { sector: 'Healthcare', symbol: 'XLV' },
  { sector: 'Real Estate', symbol: 'XLRE' },
  { sector: 'Utilities', symbol: 'XLU' }
];

function getSectorEtfFor(sectorName) {
  return SECTOR_ETFS.find((s) => s.sector === sectorName) || null;
}

module.exports = { SECTOR_ETFS, getSectorEtfFor };
