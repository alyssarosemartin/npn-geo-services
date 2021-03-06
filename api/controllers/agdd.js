let log = require('../../logger.js');
const moment = require('moment');
let agddController = require('../helpers/agdd.js');
let general = require('../helpers/general.js');

function getBaseFromLayerName(layerName) {
    if (layerName.includes('50')) {
        return 50;
    } else {
        return 32;
    }
}

function getParam(param) {
    if (param != null) {
        return param.value
    } else {
        return null;
    }
}


/**
 * @param {{swagger}} req
 */
function areaStats(req, res) {
    let anomaly = false;
    return areaStatsInternal(req, res, anomaly);
}

/**
 * @param {{swagger}} req
 */
function anomalyAreaStats(req, res) {
    let anomaly = true;
    return areaStatsInternal(req, res, anomaly);
}

function areaStatsInternal(req, res, anomaly) {
    let fwsBoundary = getParam(req.swagger.params['fwsBoundary']);
    let stateBoundary = getParam(req.swagger.params['stateBoundary']);
    let layerName = getParam(req.swagger.params['layerName']);
    let base = getParam(req.swagger.params['base']);
    let date = getParam(req.swagger.params['date']);
    let climate = anomaly ? null : 'NCEP';
    let useBufferedBoundary = getParam(req.swagger.params['useBufferedBoundary']) || false;
    let useConvexHullBoundary = getParam(req.swagger.params['useConvexHullBoundary']) || false;
    let useCache = getParam(req.swagger.params['useCache']);

    if (layerName) {
        base = getBaseFromLayerName(layerName);
    }

    let boundaryTable = "";
    let boundary = "";
    let boundaryColumn = "";
    if(fwsBoundary) {
        if(useBufferedBoundary) {
            useConvexHullBoundary = false;
            boundaryTable = "fws_boundaries_buff30km";
        } else {
            boundaryTable = "fws_boundaries";
            if(general.mustUseConvexHull.includes(fwsBoundary)) {
                useConvexHullBoundary = true;
            }
        }
        boundary = fwsBoundary;
        boundaryColumn = "orgname";
    } else if(stateBoundary) {
        useConvexHullBoundary = false;
        boundaryTable = "state_boundaries";
        boundary = stateBoundary;
        boundaryColumn = "name";
    } else {
        res.status(500).json({"message": "Invalid Boundary"});
    }

    if (useCache) {
        return agddController.getAgddAreaStatsWithCaching(boundary, boundaryTable, boundaryColumn, moment.utc(date), base, climate, useConvexHullBoundary, anomaly)
            .then((areaStatsResponse) => res.status(200).send(areaStatsResponse))
            .catch((error) => res.status(500).json({"message": error.message}));
    } else {
        return agddController.getAgddAreaStats(boundary, boundaryTable, boundaryColumn, moment.utc(date), base, climate, useConvexHullBoundary, anomaly)
            .then((areaStatsResponse) => res.status(200).send(areaStatsResponse))
            .catch((error) => res.status(500).json({"message": error.message}));
    }
}

// async function areaStatsTimeSeries(req, res) {
//     let boundary = req.swagger.params['boundary'].value;
//     let startYear = req.swagger.params['yearStart'].value;
//     let endYear = req.swagger.params['yearEnd'].value;
//     let base = req.swagger.params['base'].value;
//     let climate = req.swagger.params['climate'].value;
//
//     let yearRange = [...Array(endYear - startYear + 1).keys()].map(i => startYear + i);
//
//     try {
//         let promiseResults = await Promise.all(yearRange.map(async (year) => {
//             let resultForYear = await agddController.getAgddAreaStats(boundary, moment.utc(new Date(year, 0, 1)), base, climate);
//             resultForYear.year = year;
//             return resultForYear;
//         }));
//         return res.status(200).send({timeSeries: promiseResults});
//     } catch(error) {
//         res.status(500).json({"message": error.message});
//     }
// }


/**
 * @param {{swagger}} req
 */
function pestMap(req, res) {
    let species = getParam(req.swagger.params['species']);
    let date = getParam(req.swagger.params['date']);
    let aprilStartDate = getParam(req.swagger.params['aprilStartDate']);
    let preserveExtent = getParam(req.swagger.params['preserveExtent']);

    return agddController.getPestMap(species, moment.utc(date), preserveExtent)
        .then((areaStatsResponse) => res.status(200).send(areaStatsResponse))
        .catch((error) => res.status(500).json({"message": error.message}));

    res.status(500).json({"message": 'not yet implemented'});
}

/**
 * @param {{swagger}} req
 */
function clippedImage(req, res) {
    let anomaly = false;
    return clippedImageInternal(req, res, anomaly);
}

/**
 * @param {{swagger}} req
 */
function anomalyClippedImage(req, res) {
    let anomaly = true;
    return clippedImageInternal(req, res, anomaly);
}

/**
 * @param {{swagger}} req
 */
function clippedImageInternal(req, res, anomaly) {
    let fwsBoundary = getParam(req.swagger.params['fwsBoundary']);
    let stateBoundary = getParam(req.swagger.params['stateBoundary']);
    let layerName = getParam(req.swagger.params['layerName']);
    let base = getParam(req.swagger.params['base']);
    let date = getParam(req.swagger.params['date']);
    let climate = anomaly ? null : 'NCEP';
    let style = getParam(req.swagger.params['style']);
    let fileFormat = getParam(req.swagger.params['fileFormat']);
    let useBufferedBoundary = getParam(req.swagger.params['useBufferedBoundary']) || false;
    let useConvexHullBoundary = getParam(req.swagger.params['useConvexHullBoundary']) || false;

    if (layerName) {
        base = getBaseFromLayerName(layerName);
    }

    let boundaryTable = "";
    let boundary = "";
    let boundaryColumn = "";
    if(fwsBoundary) {
        if(useBufferedBoundary) {
            boundaryTable = "fws_boundaries_buff30km";
            useConvexHullBoundary = false;
        } else {
            boundaryTable = "fws_boundaries";
            if(general.mustUseConvexHull.includes(fwsBoundary)) {
                useConvexHullBoundary = true;
            }
        }
        boundary = fwsBoundary;
        boundaryColumn = "orgname";
    } else if(stateBoundary) {
        useConvexHullBoundary = false;
        boundaryTable = "state_boundaries";
        boundary = stateBoundary;
        boundaryColumn = "name";
    } else {
        res.status(500).json({"message": "Invalid Boundary"});
    }

    if (style) {
        return agddController.getClippedAgddImage(boundary, boundaryTable, boundaryColumn, moment.utc(date), base, climate, fileFormat, useBufferedBoundary, useConvexHullBoundary, anomaly)
            .then((areaStatsResponse) => res.status(200).send(areaStatsResponse))
            .catch((error) => res.status(500).json({"message": error.message}));
    } else {
        return agddController.getClippedAgddRaster(boundary, boundaryTable, boundaryColumn, moment.utc(date), base, climate, fileFormat, useBufferedBoundary, useConvexHullBoundary, anomaly)
            .then((areaStatsResponse) => res.status(200).send(areaStatsResponse))
            .catch((error) => res.status(500).json({"message": error.message}));
    }
}

module.exports.areaStats = areaStats;
module.exports.anomalyAreaStats = anomalyAreaStats;
module.exports.clippedImage = clippedImage;
module.exports.pestMap = pestMap;
module.exports.anomalyClippedImage = anomalyClippedImage;
// module.exports.areaStatsTimeSeries = areaStatsTimeSeries;
