let db = require('./database.js');
let log = require('../../logger.js');
const moment = require('moment');
let helpers = require('./general');
var fs = require('fs');

const imagePath = '/var/www/data-site/files/npn-geo-services/clipped_images/';
const pestImagePath = imagePath + 'pest_maps/';

// to pick up all pixels inside boundary we need to buffer around the shapefile before doing a clip,
// the size of this buffer depends on the dataset resolution. This function returns the correct buffer size.
function getBufferSizeForTable(rastTable) {
    let buffer = .01;
    if (rastTable === 'agdd_prism') {
        buffer = .02;
    }
    return buffer;
}

// returns the number of tiles the boundary intersects
async function boundaryRasterIntersections(rastTable, boundary, boundaryTable, boundaryColumn, date, base) {
    const query = {
        text: `
        SELECT COUNT(*) AS intersections
        FROM ${rastTable} r, ${boundaryTable} p 
        WHERE p.${boundaryColumn} = $1 AND ST_Intersects(r.rast, p.geom) AND r.rast_date = $2 AND r.base = $3`,
        values: [boundary, date.format('YYYY-MM-DD'), base]
    };
    const res = await db.pgPool.query(query);
    return parseInt(res.rows[0].intersections);
}

// choose table via selected data and boundary tile intersection (for ncep alaska)
async function getAppropriateAgddTable(date, climate, boundary, boundaryTable, boundaryColumn, base, anomaly) {
    if (anomaly) {
        return `agdd_anomaly_${date.year()}`;
    }
    let rasterCellsInBoundary = await boundaryRasterIntersections(`agdd_alaska_${date.year()}`, boundary, boundaryTable, boundaryColumn, date, base);
    if (rasterCellsInBoundary > 0) {
        return `agdd_alaska_${date.year()}`;
    } else {
        return `agdd_${date.year()}`;
    }
}


// gets si-x stats for functions params, if saveToCache is true, also saves result to the cache table
async function getPostgisClippedRasterAgddStats(climate, rastTable, boundary, boundaryTable, boundaryColumn, date, base, saveToCache, useConvexHullBoundary) {
    let buffer = getBufferSizeForTable(rastTable);

    const query = {
        text: `
        SELECT (ST_SummaryStats(ST_Union(ST_Clip(r.rast, ${useConvexHullBoundary ? 'foo.convex_hull_boundary' : 'foo.boundary'}, -9999, true)), true)).*
        FROM (
            SELECT ST_Buffer(ST_Union(p.geom), $1) AS boundary,
            ST_ConvexHull(ST_Union(p.geom)) AS convex_hull_boundary
            FROM ${boundaryTable} p
            WHERE p.${boundaryColumn} = $2
        ) as foo
        INNER JOIN ${rastTable} r ON ST_Intersects(r.rast, foo.convex_hull_boundary)
        AND r.rast_date = $3
        AND r.base = $4`,
        values: [buffer, boundary, date.format('YYYY-MM-DD'), base]
    };
    console.log(query.text);

    const res = await db.pgPool.query(query);

    let response = {date: date.format('YYYY-MM-DD')};
    if (res.rows.length > 0) {
        response.count = Number(res.rows[0].count);
        response.sum = res.rows[0].sum;
        response.mean = res.rows[0].mean;
        response.stddev = res.rows[0].stddev;
        response.min = res.rows[0].min;
        response.max = res.rows[0].max;

        // save the results to the caching table
        // if (saveToCache) {
        //     await saveAgddAreaStatsToCache(boundary, plant, phenophase, climate, date, response.count, response.mean, response.stddev, response.min, response.max, response.percentComplete);
        // }
    }
    return response;
}


// async function getPostgisClippedRasterAgddStats(rastTable, boundary, date, base) {
//     let buffer = getBufferSizeForTable(rastTable);
//
//     const query = {
//         text: `
//         SELECT
//     (ST_SummaryStats(ST_Union(ST_Clip(r.rast, ST_Buffer(foo.boundary, $1), true)), true)).*,
//     ST_Union(foo.boundary) AS shapefile
//     FROM (SELECT p.gid as gid, p.geom AS boundary FROM fws_boundaries p WHERE p.orgname = $2) as foo
//     INNER JOIN ${rastTable} r ON ST_Intersects(r.rast, foo.boundary)
//     AND r.rast_date = $3
//     AND r.base = $4
//     AND r.scale='fahrenheit';`,
//         values: [buffer, boundary, date.format('YYYY-MM-DD'), base]
//     };
//
//     // let query = `SELECT
//     // ST_AsGeoJSON(ST_Union(foo.boundary)) as geojson,
//     // (ST_SummaryStats(ST_Union(ST_Clip(r.rast, ST_Buffer(foo.boundary, ${buffer}), true)), true)).*,
//     // ST_AsTIFF(ST_Union(ST_Clip(r.rast, ST_Buffer(foo.boundary, ${buffer}), true))) AS tiffy,
//     // ST_Union(foo.boundary) AS shapefile
//     // FROM (SELECT p.gid as gid, p.geom AS boundary FROM fws_boundaries p WHERE p.orgname = '${boundary}') as foo
//     // INNER JOIN ${rastTable} r ON ST_Intersects(r.rast, foo.boundary)
//     // AND r.rast_date = '${date.format('YYYY-MM-DD')}'
//     // AND r.base='${base}'
//     // AND r.scale='fahrenheit';`;
//
//     console.log(query);
//     const res = await pgPool.query(query);
//
//     let response = {date: date.format('YYYY-MM-DD')};
//     if (res.rows.length > 0) {
//         response.count = res.rows[0].count;
//         response.sum = res.rows[0].sum;
//         response.mean = res.rows[0].mean;
//         response.stddev = res.rows[0].stddev;
//         response.min = res.rows[0].min;
//         response.max = res.rows[0].max;
//         response.zippedShapeFile = `http://geoserver-dev.usanpn.org/geoserver/gdd/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=gdd:fws_boundaries&CQL_FILTER=orgname='${boundary}'&maxFeatures=50&outputFormat=SHAPE-ZIP`;
//     }
//     return response;
// }

// async function getAgddAreaStats(boundary, date, base, climate) {
//     let dateString = date.toISOString().split('T')[0];
//     let rastTable = await getAppropriateAgddTable(date, climate, boundary, dateString, base);
//     let response = await getPostgisClippedRasterAgddStats(rastTable, boundary, dateString, base);
//     return response;
// }


async function getAgddAreaStats(boundary, boundaryTable, boundaryColumn, date, base, climate, useConvexHullBoundary, anomaly) {
    let rastTable = await getAppropriateAgddTable(date, climate, boundary, boundaryTable, boundaryColumn, base, anomaly);
    let response = await getPostgisClippedRasterAgddStats(climate, rastTable, boundary, boundaryTable, boundaryColumn, date, base, false, useConvexHullBoundary);
    return response;
}

async function getAgddAreaStatsWithCaching(boundary, boundaryTable, boundaryColumn, date, base, climate, useConvexHullBoundary, anomaly) {

    let res = await checkAgddAreaStatsCache(boundary, date, base, climate);
    let response = {};
    if (res.rows.length > 0) {
        response.date = date.format('YYYY-MM-DD');
        response.count = res.rows[0].count;
        response.sum = res.rows[0].sum;
        response.mean = res.rows[0].mean;
        response.stddev = res.rows[0].stddev;
        response.min = res.rows[0].min;
        response.max = res.rows[0].max;
        response.percentComplete = res.rows[0].percent_complete;
    } else {
        let rastTable = await getAppropriateAgddTable(date, climate, boundary, boundaryTable, boundaryColumn, base, anomaly);
        response = await getPostgisClippedRasterAgddStats(climate, rastTable, boundary, boundaryTable, boundaryColumn, date, base, true, useConvexHullBoundary);
    }
    return response;
}


// saves to disk and returns path to styled tiff for six clipping
async function getClippedAgddImage(boundary, boundaryTable, boundaryColumn, date, base, climate, fileFormat, useBufferedBoundry, useConvexHullBoundary, anomaly) {
    let rastTable = await getAppropriateAgddTable(date, climate, boundary, boundaryTable, boundaryColumn, base, anomaly);
    let layerName = anomaly ? `gdd:agdd_anomaly` : `gdd:agdd`;
    if (rastTable.includes('alaska')) {
        layerName += '_alaska';
    }
    if (base === 50) {
        layerName += '_50f';
    }

    let buffer = getBufferSizeForTable(rastTable);

    let query = {};

    if(useConvexHullBoundary) {
        query = {text: `
SELECT
ST_AsTIFF(ST_SetBandNoDataValue(ST_Union(bar.clipped_raster), 1, null)) AS tiff,
ST_Extent(ST_Envelope(bar.clipped_raster)) AS extent
FROM (
    SELECT ST_Union(ST_Clip(r.rast, foo.convex_hull_boundary, -9999, true)) AS clipped_raster
    FROM
    (
        SELECT ST_Union(p.geom) AS convex_hull_boundary
        FROM ${boundaryTable}_convexhull p
        WHERE p.${boundaryColumn} = $1
    ) AS foo
    INNER JOIN ${rastTable} r
    ON ST_Intersects(r.rast, foo.convex_hull_boundary)
    AND r.rast_date = $2
    AND r.base = $3
    AND r.scale = $4
) AS bar
    `, values: [boundary, date.format('YYYY-MM-DD'), base, 'fahrenheit']
        };
    } else {
        query = {text: `
SELECT
ST_AsTIFF(ST_SetBandNoDataValue(ST_Union(bar.clipped_raster), 1, null)) AS tiff,
ST_Extent(ST_Envelope(bar.clipped_raster)) AS extent
FROM (
    SELECT ST_Union(ST_Clip(r.rast, ${useConvexHullBoundary ? 'foo.convex_hull_boundary' : 'foo.boundary'}, -9999, true)) AS clipped_raster
    FROM
    (
        SELECT ST_Buffer(ST_Union(p.geom), $1) AS boundary,
        ST_ConvexHull(ST_Union(p.geom)) AS convex_hull_boundary
        FROM ${boundaryTable} p
        WHERE p.${boundaryColumn} = $2
    ) AS foo
    INNER JOIN ${rastTable} r
    ON ST_Intersects(r.rast, foo.convex_hull_boundary)
    AND r.rast_date = $3
    AND r.base = $4
    AND r.scale = $5
) AS bar
    `, values: [buffer, boundary, date.format('YYYY-MM-DD'), base, 'fahrenheit']
        };
    }

//     let query = {text: `
// SELECT
// ST_AsTIFF(ST_SetBandNoDataValue(ST_Union(bar.clipped_raster), 1, null)) AS tiff,
// ST_Extent(ST_Envelope(bar.clipped_raster)) AS extent
// FROM (
//     SELECT ST_Union(ST_Clip(r.rast, ${useConvexHullBoundary ? 'foo.convex_hull_boundary' : 'foo.boundary'}, -9999, true)) AS clipped_raster
//     FROM
//     (
//         SELECT ST_Buffer(ST_Union(p.geom), $1) AS boundary,
//         ST_ConvexHull(ST_Union(p.geom)) AS convex_hull_boundary
//         FROM ${boundaryTable} p
//         WHERE p.${boundaryColumn} = $2
//     ) AS foo
//     INNER JOIN ${rastTable} r
//     ON ST_Intersects(r.rast, foo.convex_hull_boundary)
//     AND r.rast_date = $3
//     AND r.base = $4
//     AND r.scale = $5
// ) AS bar
//     `, values: [buffer, boundary, date.format('YYYY-MM-DD'), base, 'fahrenheit']
//     };



    console.log(query);
    log.info(query);
    const res = await db.pgPool.query(query);
    log.info('query complete');

    let response = {date: date.format('YYYY-MM-DD'), layerClippedFrom: layerName};
    if (res.rows.length > 0) {
        let d = new Date();
        let filename = anomaly
            ? `${boundary.replace(/ /g, '_')}_agdd_anomaly_${base}f_${date.format('YYYY-MM-DD')}_${d.getTime()}.${fileFormat}`
            : `${boundary.replace(/ /g, '_')}_agdd_${base}f_${date.format('YYYY-MM-DD')}_${d.getTime()}.${fileFormat}`;
        await helpers.WriteFile(imagePath + filename, res.rows[0].tiff);
        response.clippedImage = await helpers.stylizeFile(filename, imagePath, fileFormat, layerName);
        response.bbox = helpers.extractFloatsFromString(res.rows[0].extent);
        return response;
    } else {
        return response;
    }
}

async function getClippedAgddRaster() {

}


// saves to disk and returns path to styled tiff for six clipping
async function getPestMap(species, date, preserveExtent) {

    let layerName = `gdd:agdd_50f`;
    let bounds = [];
    //if stateNames is left empty, no clipping will occur
    let stateNames = [];
    let sldName = '';
    let base = 50;

    if(species === 'Emerald Ash Borer') {
        sldName = 'emerald_ash_borer.sld';
        bounds = [
            -109.0712618165,
            24.5049877850162,
            -66.9509145889486,
            49.4107288273616
        ];
        // -109.0712618165,
        //     25.8324511400651,
        //     -69.9161870337683,
        //     49.4107288273616
        stateNames = ["'Maine'", "'Vermont'", "'Colorado'", "'Nebraska'", "'Kansas'", "'Oklahoma'", "'Texas'", "'Minnesota'",
            "'Iowa'", "'Missouri'", "'Arkansas'", "'Louisiana'", "'Wisconsin'", "'Illinois'",
            "'Kentucky'", "'Tennessee'", "'Mississippi'", "'Michigan'", "'Indiana'", "'Alabama'",
            "'Ohio'", "'Alabama'", "'Georgia'", "'South Carolina'", "'North Carolina'", "'Virginia'",
            "'West Virginia'", "'District of Columbia'", "'Maryland'", "'Delaware'", "'New Jersey'", "'Pennsylvania'",
            "'New York'", "'Connecticut'", "'Rhode Island'", "'Massachusetts'", "'New Hampshire'", "'Florida'"];
    } else if(species === 'Apple Maggot') {
        sldName = 'apple_maggot.sld';
        stateNames = [];
        bounds = [
            -125.0208333,
            24.0625,
            -66.4791667000001,
            49.9375
        ];
    } else if(species === 'Hemlock Woolly Adelgid') {
        layerName = `gdd:agdd`;
        base = 32;
        sldName = 'hemlock_woolly_adelgid.sld';
        bounds = [
            -124.773727262932,
            30.2151872964169,
            -66.9509145889486,
            49.4107288273616
        ];
        stateNames = ["'Maine'", "'Vermont'", "'New Hampshire'", "'New York'", "'Connecticut'", "'Massachusetts'",
            "'Rhode Island'", "'New Jersey'", "'Pennsylvania'", "'Delaware'", "'Maryland'", "'Virginia'",
            "'West Virginia'", "'Ohio'", "'Kentucky'", "'Michigan'", "'Tennessee'", "'North Carolina'",
            "'South Carolina'", "'Alabama'", "'Georgia'", "'Wisconsin'", "'Minnesota'", "'Indiana'",
            "'Washington'", "'Oregon'", "'California'", "'Idaho'", "'Montana'"];
    } else if(species === 'Winter Moth') {
        sldName = 'winter_moth.sld';
        bounds = [
            -79.7779643313124,
            40.4766897394137,
            -66.9509145889486,
            47.4722109120521
        ];
        stateNames = ["'New York'", "'Connecticut'", "'New Hampshire'", "'Vermont'", "'Maine'", "'Massachusetts'"];
    } else if(species === 'Lilac Borer') {
        sldName = 'lilac_borer.sld';
        bounds = [
            -125.0208333,
            24.0625,
            -66.4791667000001,
            49.9375
        ];
    } else {
        //todo other species
    }

    //if file exists don't recompute it
    let styledFileName = `${species.replace(/ /g, '_')}_${date.format('YYYY-MM-DD')}_styled.png`;
    if (!preserveExtent && fs.existsSync(pestImagePath + styledFileName)) {
        let response = {
            date: date.format('YYYY-MM-DD'),
            layerClippedFrom: layerName,
            clippedImage: `${process.env.PROTOCOL}://${process.env.SERVICES_HOST}:${process.env.PORT}/pest_maps/` + styledFileName,
            bbox: bounds
        };
        return response;
    }


    let rastTable = `agdd_${date.year()}`;
    let buffer = getBufferSizeForTable(rastTable);

    let boundaryTable = "state_boundaries";
    let boundaryColumn = "name";

    let query = {};
    if(preserveExtent && stateNames.length < 1) {
        query = {text: `
SELECT
ST_AsTIFF(ST_Transform(ST_SetBandNoDataValue(ST_Union(bar.conus_raster), 1, null), 3857)) AS tiff,
ST_Extent(ST_Envelope(ST_Transform(bar.conus_raster, 3857))) AS extent
FROM (
    SELECT ST_Union(r.rast) AS conus_raster
    FROM ${rastTable} r
    WHERE r.rast_date = $1
    AND r.base = $2
    AND r.scale = $3
) AS bar
    `, values: [date.format('YYYY-MM-DD'), base, 'fahrenheit']
        };
    } else if(preserveExtent) {
        query = {text: `
WITH boundary AS (
SELECT ST_Buffer(ST_Union(p.geom), .01) AS states
FROM ${boundaryTable} p
WHERE p.${boundaryColumn} IN (${stateNames})
)
SELECT ST_AsTIFF(ST_Transform(ST_SetBandNoDataValue(ST_Clip(ST_Union(r.rast), (SELECT states FROM boundary), -9999, false), 1, null), 3857)) AS tiff
FROM ${rastTable} r
WHERE r.rast_date = $1
AND r.base = $2
AND r.scale = $3
`, values: [date.format('YYYY-MM-DD'), base, 'fahrenheit']
        };
    } else if(stateNames.length < 1) {
        query = {text: `
SELECT
ST_AsTIFF(ST_SetBandNoDataValue(ST_Union(bar.conus_raster), 1, null)) AS tiff,
ST_Extent(ST_Envelope(bar.conus_raster)) AS extent
FROM (
    SELECT ST_Union(r.rast) AS conus_raster
    FROM ${rastTable} r
    WHERE r.rast_date = $1
    AND r.base = $2
    AND r.scale = $3
) AS bar
    `, values: [date.format('YYYY-MM-DD'), base, 'fahrenheit']
        };
    } else {
        query = {text: `
SELECT
ST_AsTIFF(ST_SetBandNoDataValue(ST_Union(bar.clipped_raster), 1, null)) AS tiff,
ST_Extent(ST_Envelope(bar.clipped_raster)) AS extent
FROM (
    SELECT ST_Union(ST_Clip(r.rast, foo.boundary, -9999, true)) AS clipped_raster
    FROM
    (
        SELECT ST_Buffer(ST_Union(p.geom), .01) AS boundary,
        ST_ConvexHull(ST_Union(p.geom)) AS convex_hull_boundary
        FROM ${boundaryTable} p
        WHERE p.${boundaryColumn} IN (${stateNames})
    ) AS foo
    INNER JOIN ${rastTable} r
    ON ST_Intersects(r.rast, foo.convex_hull_boundary)
    AND r.rast_date = $1
    AND r.base = $2
    AND r.scale = $3
) AS bar
    `, values: [date.format('YYYY-MM-DD'), base, 'fahrenheit']
        };
    }

    console.log(query);
    log.info(query);
    const res = await db.pgPool.query(query);
    log.info('query complete');

    let response = {date: date.format('YYYY-MM-DD'), layerClippedFrom: layerName};
    if (res.rows.length > 0) {
        let pngFilename = `${species.replace(/ /g, '_')}_${date.format('YYYY-MM-DD')}.png`;
        if (preserveExtent) {
            pngFilename = `${species.replace(/ /g, '_')}_${date.format('YYYY-MM-DD')}_nocache.png`;
        }
        await helpers.WriteFile(pestImagePath + pngFilename, res.rows[0].tiff);
        response.clippedImage = await helpers.stylizePestMap(pngFilename, pestImagePath, 'png', sldName);
        response.bbox = helpers.extractFloatsFromString(res.rows[0].extent);
        return response;
    } else {
        return response;
    }
}

module.exports.getPestMap = getPestMap;
module.exports.getClippedAgddImage = getClippedAgddImage;
module.exports.getClippedAgddRaster = getClippedAgddRaster;
module.exports.getAgddAreaStats = getAgddAreaStats;
module.exports.getAgddAreaStatsWithCaching = getAgddAreaStatsWithCaching;
