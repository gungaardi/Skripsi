// =============================================================================
// BARE SOIL INDEX (BSI) - KABUPATEN INDRAMAYU
// Komparasi Regresi Linear Berganda dan Random Forest untuk Estimasi
// Kelembaban Tanah Sawah pada Tanah Terbuka Berbasis Citra Sentinel-2
//
// Periode: Februari - Mei 2026
// =============================================================================
// CATATAN: script ini menggunakan 2 asset dari Imports:
//   - geometry : full boundary Kabupaten Indramayu
//   - table    : shapefile Lahan Baku Sawah (LBS) untuk masking
// =============================================================================


// =============================================================================
// 1. AREA STUDI
// =============================================================================

var studyArea = geometry;
var lbs       = table;

Map.centerObject(lbs, 10);
Map.addLayer(studyArea, {color: '808080'}, 'Batas Kabupaten Indramayu', false);
Map.addLayer(lbs, {color: '00AA00'}, 'Lahan Baku Sawah (LBS)');


// =============================================================================
// 2. FUNGSI PREPROCESSING
// =============================================================================

function maskS2Clouds(image) {
  var scl = image.select('SCL');
  var cloudMask = scl.neq(3)
    .and(scl.neq(7))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10));
  return image.updateMask(cloudMask);
}

function scaleReflectance(image) {
  var optical = image.select(['B2','B4','B8','B11']).divide(10000);
  return image.addBands(optical, null, true);
}

function computeBSI(image) {
  var bsi = image.expression(
    '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
    {
      'SWIR1': image.select('B11'),
      'RED'  : image.select('B4'),
      'NIR'  : image.select('B8'),
      'BLUE' : image.select('B2')
    }
  ).rename('BSI');
  return image.addBands(bsi);
}


// =============================================================================
// 3. KOLEKSI PER BULAN (PISAH AGAR TIDAK MEMORY OVERFLOW)
// =============================================================================

var BSI_THRESHOLD = 0.021;

var colFeb = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(studyArea)
  .filterDate('2026-02-01', '2026-02-28')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(maskS2Clouds).map(scaleReflectance).map(computeBSI);

var colMar = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(studyArea)
  .filterDate('2026-03-01', '2026-03-31')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(maskS2Clouds).map(scaleReflectance).map(computeBSI);

var colApr = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(studyArea)
  .filterDate('2026-04-01', '2026-04-30')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(maskS2Clouds).map(scaleReflectance).map(computeBSI);

var colMei = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(studyArea)
  .filterDate('2026-05-01', '2026-05-07')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(maskS2Clouds).map(scaleReflectance).map(computeBSI);

// Koleksi gabungan April-Mei untuk komposit tambahan
var colAprMei = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(studyArea)
  .filterDate('2026-04-01', '2026-05-07')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(maskS2Clouds).map(scaleReflectance).map(computeBSI);

print('Scene Februari:', colFeb.size());
print('Scene Maret:', colMar.size());
print('Scene April:', colApr.size());
print('Scene Mei:', colMei.size());
print('Scene April-Mei (gabungan):', colAprMei.size());


// =============================================================================
// 4. KOMPOSIT BULANAN + KOMPOSIT APRIL-MEI
// =============================================================================

var compFeb    = colFeb.qualityMosaic('BSI').clip(lbs);
var compMar    = colMar.qualityMosaic('BSI').clip(lbs);
var compApr    = colApr.qualityMosaic('BSI').clip(lbs);
var compMei    = colMei.qualityMosaic('BSI').clip(lbs);
var compAprMei = colAprMei.qualityMosaic('BSI').clip(lbs); // ← komposit baru

// Komposit full periode Feb-Mei 2026
var fullComposite = ee.ImageCollection([compFeb, compMar, compApr, compMei])
  .qualityMosaic('BSI');

var bareSoilMask = fullComposite.select('BSI').gt(BSI_THRESHOLD);
var bareSoilArea = fullComposite.select('BSI')
  .updateMask(bareSoilMask)
  .rename('bare_soil_BSI');

// Bare soil khusus April-Mei
var bareSoilMaskAprMei = compAprMei.select('BSI').gt(BSI_THRESHOLD);
var bareSoilAreaAprMei = compAprMei.select('BSI')
  .updateMask(bareSoilMaskAprMei)
  .rename('bare_soil_BSI');


// =============================================================================
// 5. STATISTIK LUAS BARE SOIL PER BULAN
// =============================================================================

var pixelArea = ee.Image.pixelArea();

var printArea = function(name, comp) {
  var bareMask = comp.select('BSI').gt(BSI_THRESHOLD);
  var areaHa   = pixelArea.updateMask(bareMask).reduceRegion({
    reducer  : ee.Reducer.sum(),
    geometry : lbs.geometry(),
    scale    : 20,
    maxPixels: 1e13
  }).getNumber('area').divide(10000);
  print('Luas bare soil ' + name + ' 2026 (Ha):', areaHa);
};

printArea('Februari',       compFeb);
printArea('Maret',          compMar);
printArea('April',          compApr);
printArea('Mei',            compMei);
printArea('April-Mei',      compAprMei);


// =============================================================================
// 6. VISUALISASI
// =============================================================================

var bsiVis = {min: -0.3, max: 0.3, palette: ['1a9641', 'ffffbf', '8B4513']};

Map.addLayer(fullComposite.select('BSI'),    bsiVis, 'BSI Komposit Feb-Mei 2026');
Map.addLayer(compAprMei.select('BSI'),       bsiVis, 'BSI Komposit Apr-Mei 2026', false);
Map.addLayer(
  bareSoilArea,
  {min: BSI_THRESHOLD, max: 0.3, palette: ['F5DEB3', 'C8862A', '8B4513']},
  'Bare Soil (BSI > 0.021) Feb-Mei'
);
Map.addLayer(
  bareSoilAreaAprMei,
  {min: BSI_THRESHOLD, max: 0.3, palette: ['F5DEB3', 'C8862A', '8B4513']},
  'Bare Soil (BSI > 0.021) Apr-Mei', false
);
Map.addLayer(compFeb.select('BSI'), bsiVis, 'BSI Februari 2026', false);
Map.addLayer(compMar.select('BSI'), bsiVis, 'BSI Maret 2026',    false);
Map.addLayer(compApr.select('BSI'), bsiVis, 'BSI April 2026',    false);
Map.addLayer(compMei.select('BSI'), bsiVis, 'BSI Mei 2026',      false);
Map.addLayer(
  fullComposite.select(['B4','B3','B2']),
  {min: 0, max: 0.3},
  'RGB Natural Color', false
);


// =============================================================================
// 7. EXPORT KE GOOGLE DRIVE
// =============================================================================

Export.image.toDrive({
  image         : fullComposite.select('BSI').toFloat(),
  description   : 'BSI_Komposit_FebMei2026',
  folder        : 'BSI_Indramayu_2026',
  fileNamePrefix: 'BSI_komposit_FebMei2026',
  region        : lbs.geometry(),
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

Export.image.toDrive({
  image         : compAprMei.select('BSI').toFloat(),
  description   : 'BSI_Komposit_AprMei2026',
  folder        : 'BSI_Indramayu_2026',
  fileNamePrefix: 'BSI_komposit_AprMei2026',
  region        : lbs.geometry(),
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

Export.image.toDrive({
  image         : bareSoilMask.toFloat(),
  description   : 'BareSoil_Mask_FebMei2026',
  folder        : 'BSI_Indramayu_2026',
  fileNamePrefix: 'bareSoil_mask_FebMei2026',
  region        : lbs.geometry(),
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

Export.image.toDrive({
  image         : bareSoilMaskAprMei.toFloat(),
  description   : 'BareSoil_Mask_AprMei2026',
  folder        : 'BSI_Indramayu_2026',
  fileNamePrefix: 'bareSoil_mask_AprMei2026',
  region        : lbs.geometry(),
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

Export.image.toDrive({
  image         : compFeb.select('BSI').toFloat(),
  description   : 'BSI_Februari_2026',
  folder        : 'BSI_Indramayu_2026',
  fileNamePrefix: 'BSI_Februari_2026',
  region        : lbs.geometry(),
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

Export.image.toDrive({
  image         : compMar.select('BSI').toFloat(),
  description   : 'BSI_Maret_2026',
  folder        : 'BSI_Indramayu_2026',
  fileNamePrefix: 'BSI_Maret_2026',
  region        : lbs.geometry(),
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

Export.image.toDrive({
  image         : compApr.select('BSI').toFloat(),
  description   : 'BSI_April_2026',
  folder        : 'BSI_Indramayu_2026',
  fileNamePrefix: 'BSI_April_2026',
  region        : lbs.geometry(),
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

Export.image.toDrive({
  image         : compMei.select('BSI').toFloat(),
  description   : 'BSI_Mei_2026',
  folder        : 'BSI_Indramayu_2026',
  fileNamePrefix: 'BSI_Mei_2026',
  region        : lbs.geometry(),
  scale         : 20,
  crs           : 'EPSG:32748',
  maxPixels     : 1e13
});

print('=== Script BSI selesai ===');
print('Palette: Hijau = vegetasi | Kuning = transisi | Coklat = bare soil');
print('Jalankan export di Tasks panel (kanan atas GEE)');
