// =============================================================================
// EKSTRAKSI NILAI PIKSEL SENTINEL-2 PADA TITIK PENGAMATAN
// Kelompok A (10m): B2, B3, B4, B8
// Kelompok B (20m): B5, B6, B7, B8a, B11, B12, NSMI_SWIR
// Scene: 10 Mei 2026 (T48MZT + T48MZU)
// =============================================================================

// =============================================================================
// 1. LOAD ASSET
// =============================================================================

var titikLapangan = ee.FeatureCollection('projects/skripsuiii/assets/Hasil_Lapangan');

// Filter hanya titik Normal (exclude Bare Tergenang)
var titikNormal = titikLapangan.filter(ee.Filter.eq('Kondisi', 'Normal'));

print('Total titik:', titikLapangan.size());
print('Titik efektif (Normal):', titikNormal.size());


// =============================================================================
// 2. LOAD SCENE SENTINEL-2 - 10 MEI 2026
// =============================================================================

var aoi = titikNormal.geometry().bounds();

var s2Scene = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate('2026-05-10', '2026-05-12')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(function(image) {
    // Masking awan menggunakan SCL
    var scl = image.select('SCL');
    var cloudMask = scl.neq(3)
      .and(scl.neq(7))
      .and(scl.neq(8))
      .and(scl.neq(9))
      .and(scl.neq(10));
    return image.updateMask(cloudMask);
  })
  .map(function(image) {
    // Scale ke surface reflectance 0-1
    var scaled = image.select(['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'])
      .divide(10000);
    return image.addBands(scaled, null, true);
  });

// Mosaic dua tile T48MZT dan T48MZU
var s2Mosaic = s2Scene.mosaic();

print('Jumlah scene (10 Mei 2026):', s2Scene.size());


// =============================================================================
// 3. HITUNG NSMI-SWIR
// NSMI-SWIR = (B11 - B12) / (B11 + B12)
// =============================================================================

var nsmiSwir = s2Mosaic.normalizedDifference(['B11', 'B12']).rename('NSMI_SWIR');
var s2Final = s2Mosaic.addBands(nsmiSwir);


// =============================================================================
// 3B. HITUNG BSI (Bare Soil Index) - khusus 10 Mei 2026
// BSI = ((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))
// Formula: Diek et al. (2017), threshold > 0.021
// CATATAN: B11 native 20m, B4/B8/B2 native 10m -> GEE reproject otomatis
// saat dipakai bersama dalam expression. Untuk QC visual ini tidak masalah,
// tapi jangan dipakai sebagai variabel kuantitatif tanpa menyamakan resolusi.
// =============================================================================

var BSI_THRESHOLD = 0.021;

var bsi10Mei = s2Final.expression(
  '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
  {
    'SWIR1': s2Final.select('B11'),
    'RED'  : s2Final.select('B4'),
    'NIR'  : s2Final.select('B8'),
    'BLUE' : s2Final.select('B2')
  }
).rename('BSI');

s2Final = s2Final.addBands(bsi10Mei);

var bareSoilMask10Mei = s2Final.select('BSI').gt(BSI_THRESHOLD);
var bareSoil10Mei = s2Final.select('BSI')
  .updateMask(bareSoilMask10Mei)
  .rename('bare_soil_BSI');


// =============================================================================
// 4. EKSTRAKSI KELOMPOK A - RESOLUSI 10m
// Band: B2, B3, B4, B8
// =============================================================================

var kelompokA = s2Final.select(['B2','B3','B4','B8']);

var ekstraksiA = kelompokA.sampleRegions({
  collection: titikNormal,
  properties: ['fid', 'Titik_Pengamatan', 'Kelembaban', 'Kondisi'],
  scale: 10,
  geometries: true
});

print('Kelompok A - jumlah titik terekstrak:', ekstraksiA.size());


// =============================================================================
// 5. EKSTRAKSI KELOMPOK B - RESOLUSI 20m
// Band: B5, B6, B7, B8A, B11, B12, NSMI_SWIR
// =============================================================================

var kelompokB = s2Final.select(['B5','B6','B7','B8A','B11','B12','NSMI_SWIR']);

var ekstraksiB = kelompokB.sampleRegions({
  collection: titikNormal,
  properties: ['fid', 'Titik_Pengamatan', 'Kelembaban', 'Kondisi'],
  scale: 20,
  geometries: true
});

print('Kelompok B - jumlah titik terekstrak:', ekstraksiB.size());


// =============================================================================
// 6. VISUALISASI VERIFIKASI
// =============================================================================

Map.centerObject(titikNormal, 11);

// Tampilkan RGB 10 Mei
Map.addLayer(
  s2Final.select(['B4','B3','B2']),
  {min: 0, max: 0.3},
  'RGB 10 Mei 2026'
);

// BSI 10 Mei 2026
var bsiVis = {min: -0.3, max: 0.3, palette: ['1a9641', 'ffffbf', '8B4513']};

Map.addLayer(
  s2Final.select('BSI'),
  bsiVis,
  'BSI 10 Mei 2026'
);

// Bare soil (BSI > threshold) 10 Mei 2026
Map.addLayer(
  bareSoil10Mei,
  {min: BSI_THRESHOLD, max: 0.3, palette: ['F5DEB3', 'C8862A', '8B4513']},
  'Bare Soil (BSI > 0.021) 10 Mei 2026'
);

// Titik Normal
Map.addLayer(
  titikNormal,
  {color: '000000'},
  'Titik Normal (43)'
);

// Titik Tergenang
Map.addLayer(
  titikLapangan.filter(ee.Filter.eq('Kondisi', 'Bare Tergenang')),
  {color: 'FF0000'},
  'Titik Tergenang (6)'
);


// =============================================================================
// 7. EXPORT KE GOOGLE DRIVE
// =============================================================================

// Export Kelompok A
Export.table.toDrive({
  collection  : ekstraksiA,
  description : 'Ekstraksi_KelompokA_10m',
  folder      : 'Ekstraksi_Sentinel2',
  fileNamePrefix: 'kelompokA_10m_Mei2026',
  fileFormat  : 'CSV'
});

// Export Kelompok B
Export.table.toDrive({
  collection  : ekstraksiB,
  description : 'Ekstraksi_KelompokB_20m',
  folder      : 'Ekstraksi_Sentinel2',
  fileNamePrefix: 'kelompokB_20m_Mei2026',
  fileFormat  : 'CSV'
});

// Export BSI (kontinu) - 10 Mei 2026
Export.image.toDrive({
  image         : bsi10Mei.toFloat(),
  description   : 'BSI_10Mei2026',
  folder        : 'Ekstraksi_Sentinel2',
  fileNamePrefix: 'BSI_10Mei2026',
  region        : aoi,
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

// Export Bare Soil Mask (BSI > 0.021) - 10 Mei 2026
Export.image.toDrive({
  image         : bareSoilMask10Mei.toFloat(),
  description   : 'BareSoil_Mask_10Mei2026',
  folder        : 'Ekstraksi_Sentinel2',
  fileNamePrefix: 'bareSoil_mask_10Mei2026',
  region        : aoi,
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

print('=== Script ekstraksi selesai ===');
print('Jalankan export di Tasks panel');
print('Output: kelompokA_10m_Mei2026.csv, kelompokB_20m_Mei2026.csv, BSI_10Mei2026.tif, bareSoil_mask_10Mei2026.tif');

// =============================================================================
// 8. IDENTIFIKASI TITIK TIDAK TEREKSTRAK
// =============================================================================

var fidTerekstrak = ekstraksiA.aggregate_array('fid');

var titikHilang = titikNormal.filter(
  ee.Filter.inList('fid', fidTerekstrak).not()
);

print('Titik tidak terekstrak (awan):', titikHilang.size());
titikHilang.evaluate(function(fc) {
  fc.features.forEach(function(f) {
    print('FID:', f.properties.fid,
          'Titik:', f.properties.Titik_Pengamatan,
          'Koordinat:', f.geometry.coordinates);
  });
});
