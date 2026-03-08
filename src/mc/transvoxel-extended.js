/**
 * Transvoxel regular-cell extractor with sharp-feature handling:
 * - uses regularCellPolyTable components (n-gons)
 * - detects edge/corner features from normals
 * - places feature vertices via IsoEx-style SVD solve
 * - triangulates via fan around feature point or fallback poly triangulation
 */
import { regularVertexData } from '../tables/transvoxel-tables.js';
import { regularCellPolyTable, polyTable } from '../tables/transvoxel-extended-tables.js';
import { svdSolve3 } from '../math/svd-solve3.js';

// C4 / Transvoxel corner convention.
const CORNER_DELTA = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]
];

function edgeKey(vertexIndexA, vertexIndexB) {
  return vertexIndexA < vertexIndexB ? `${vertexIndexA},${vertexIndexB}` : `${vertexIndexB},${vertexIndexA}`;
}

function sampleField(gridX, gridY, gridZ, resolution, fieldFn) {
  return fieldFn(gridX / resolution, gridY / resolution, gridZ / resolution);
}

function gradientAt(positionX, positionY, positionZ, fieldFn, epsilon = 1e-6) {
  const gradientX = (fieldFn(positionX + epsilon, positionY, positionZ) - fieldFn(positionX - epsilon, positionY, positionZ)) / (2 * epsilon);
  const gradientY = (fieldFn(positionX, positionY + epsilon, positionZ) - fieldFn(positionX, positionY - epsilon, positionZ)) / (2 * epsilon);
  const gradientZ = (fieldFn(positionX, positionY, positionZ + epsilon) - fieldFn(positionX, positionY, positionZ - epsilon)) / (2 * epsilon);
  return [gradientX, gradientY, gradientZ];
}

function interpolate(position0, position1, value0, value1, isovalue) {
  const denominator = value1 - value0;
  const interpolationParameter = Math.abs(denominator) < 1e-9 ? 0.5 : (isovalue - value0) / denominator;
  return [
    position0[0] + interpolationParameter * (position1[0] - position0[0]),
    position0[1] + interpolationParameter * (position1[1] - position0[1]),
    position0[2] + interpolationParameter * (position1[2] - position0[2])
  ];
}

function findFeaturePoint(positionsForDetection, normalsForDetection, featureAngleRad, counts, positionsForSvd, normalsForSvd) {
  const detectionCount = positionsForDetection.length;
  let minimumCosine = 1;
  let axis = [0, 0, 0];
  for (let detectionIndexI = 0; detectionIndexI < detectionCount; detectionIndexI++) {
    for (let detectionIndexJ = 0; detectionIndexJ < detectionCount; detectionIndexJ++) {
      const normalDotProduct = normalsForDetection[detectionIndexI][0] * normalsForDetection[detectionIndexJ][0] + normalsForDetection[detectionIndexI][1] * normalsForDetection[detectionIndexJ][1] + normalsForDetection[detectionIndexI][2] * normalsForDetection[detectionIndexJ][2];
      if (normalDotProduct < minimumCosine) {
        minimumCosine = normalDotProduct;
        axis = [
          normalsForDetection[detectionIndexI][1] * normalsForDetection[detectionIndexJ][2] - normalsForDetection[detectionIndexI][2] * normalsForDetection[detectionIndexJ][1],
          normalsForDetection[detectionIndexI][2] * normalsForDetection[detectionIndexJ][0] - normalsForDetection[detectionIndexI][0] * normalsForDetection[detectionIndexJ][2],
          normalsForDetection[detectionIndexI][0] * normalsForDetection[detectionIndexJ][1] - normalsForDetection[detectionIndexI][1] * normalsForDetection[detectionIndexJ][0]
        ];
      }
    }
  }
  if (minimumCosine > Math.cos(featureAngleRad)) return null;

  let axisLength = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]) || 1;
  axis[0] /= axisLength; axis[1] /= axisLength; axis[2] /= axisLength;
  let minimumAxisDot = 1;
  let maximumAxisDot = -1;
  for (let detectionIndex = 0; detectionIndex < detectionCount; detectionIndex++) {
    const axisDotProduct = normalsForDetection[detectionIndex][0] * axis[0] + normalsForDetection[detectionIndex][1] * axis[1] + normalsForDetection[detectionIndex][2] * axis[2];
    if (axisDotProduct < minimumAxisDot) minimumAxisDot = axisDotProduct;
    if (axisDotProduct > maximumAxisDot) maximumAxisDot = axisDotProduct;
  }
  let spreadCosine = Math.max(Math.abs(minimumAxisDot), Math.abs(maximumAxisDot));
  spreadCosine = Math.sqrt(1 - spreadCosine * spreadCosine);
  const rank = spreadCosine > Math.cos(featureAngleRad) ? 2 : 3;
  if (rank === 2) counts.n_edges++;
  else counts.n_corners++;

  const vertexCount = positionsForSvd.length;
  const matrixA = [];
  const vectorB = [];
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    matrixA.push([normalsForSvd[vertexIndex][0], normalsForSvd[vertexIndex][1], normalsForSvd[vertexIndex][2]]);
    vectorB.push(positionsForSvd[vertexIndex][0] * normalsForSvd[vertexIndex][0] + positionsForSvd[vertexIndex][1] * normalsForSvd[vertexIndex][1] + positionsForSvd[vertexIndex][2] * normalsForSvd[vertexIndex][2]);
  }

  const point = svdSolve3(matrixA, vectorB, rank === 2);
  return { point, rank };
}

function getPos(vertices, vertexIndex) {
  return [vertices[vertexIndex * 6], vertices[vertexIndex * 6 + 1], vertices[vertexIndex * 6 + 2]];
}

function triArea(vertices, vertexA, vertexB, vertexC) {
  const position0 = getPos(vertices, vertexA);
  const position1 = getPos(vertices, vertexB);
  const position2 = getPos(vertices, vertexC);
  const edgeUx = position1[0] - position0[0], edgeUy = position1[1] - position0[1], edgeUz = position1[2] - position0[2];
  const edgeVx = position2[0] - position0[0], edgeVy = position2[1] - position0[1], edgeVz = position2[2] - position0[2];
  const crossX = edgeUy * edgeVz - edgeUz * edgeVy;
  const crossY = edgeUz * edgeVx - edgeUx * edgeVz;
  const crossZ = edgeUx * edgeVy - edgeUy * edgeVx;
  return Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
}

function flipEdges(vertices, indices, featureVertices) {
  const makeEdgeKey = (vertexA, vertexB) => (vertexA < vertexB ? `${vertexA},${vertexB}` : `${vertexB},${vertexA}`);
  const edgeToTriangles = new Map();
  for (let triangleOffset = 0; triangleOffset < indices.length; triangleOffset += 3) {
    const vertexA = indices[triangleOffset], vertexB = indices[triangleOffset + 1], vertexC = indices[triangleOffset + 2];
    for (const [edgeVertexU, edgeVertexV, oppositeVertex] of [[vertexA, vertexB, vertexC], [vertexB, vertexC, vertexA], [vertexC, vertexA, vertexB]]) {
      const edgeKeyString = makeEdgeKey(edgeVertexU, edgeVertexV);
      if (!edgeToTriangles.has(edgeKeyString)) edgeToTriangles.set(edgeKeyString, []);
      edgeToTriangles.get(edgeKeyString).push({ triangleOffset, edgeVertexU, edgeVertexV, oppositeVertex });
    }
  }

  let flipCount = 0;
  const minimumArea = 1e-14;
  for (const [edgeKeyString, triangleList] of edgeToTriangles) {
    if (triangleList.length !== 2) continue;
    const [triangle0, triangle1] = triangleList;
    const edgeVertexA = triangle0.edgeVertexU, edgeVertexB = triangle0.edgeVertexV;
    const oppositeVertex0 = triangle0.oppositeVertex, oppositeVertex1 = triangle1.oppositeVertex;
    if (!featureVertices.has(oppositeVertex0) || !featureVertices.has(oppositeVertex1)) continue;
    if (featureVertices.has(edgeVertexA) || featureVertices.has(edgeVertexB)) continue;
    const flippedEdgeKey = makeEdgeKey(oppositeVertex0, oppositeVertex1);
    if (flippedEdgeKey !== edgeKeyString && edgeToTriangles.has(flippedEdgeKey)) continue;
    if (triArea(vertices, edgeVertexA, oppositeVertex0, oppositeVertex1) < minimumArea) continue;
    if (triArea(vertices, edgeVertexB, oppositeVertex1, oppositeVertex0) < minimumArea) continue;
    const triangleIndex0 = triangle0.triangleOffset, triangleIndex1 = triangle1.triangleOffset;
    indices[triangleIndex0] = edgeVertexA; indices[triangleIndex0 + 1] = oppositeVertex0; indices[triangleIndex0 + 2] = oppositeVertex1;
    indices[triangleIndex1] = edgeVertexB; indices[triangleIndex1 + 1] = oppositeVertex1; indices[triangleIndex1 + 2] = oppositeVertex0;
    flipCount++;
  }
  if (flipCount > 0) console.log('Transvoxel Extended: edge flips =', flipCount);
}

/**
 * Run Transvoxel regular-cell extended extractor.
 * @param {number} resolution
 * @param {number} isovalue
 * @param {(x:number,y:number,z:number)=>number} fieldFn
 * @param {{ featureAngleDeg?: number }} options
 * @returns {{ vertices:number[], indices:number[] }}
 */
export function runTransvoxelExtended(resolution, isovalue, fieldFn, options = {}) {
  const featureAngleDeg = options.featureAngleDeg ?? 30;
  const featureAngleRad = (featureAngleDeg * Math.PI) / 180;

  const vertices = [];
  const indices = [];
  const vertexMap = new Map();
  const vertexLimitNormals = [];
  const featureVertices = new Set();
  const counts = { n_edges: 0, n_corners: 0 };
  let nextVertexIndex = 0;

  function getVertex(cellX, cellY, cellZ, vertexCode, cornerValues) {
    const cornerIndex0 = vertexCode & 0x07;
    const cornerIndex1 = (vertexCode >> 3) & 0x07;
    const [deltaI0, deltaJ0, deltaK0] = CORNER_DELTA[cornerIndex0];
    const [deltaI1, deltaJ1, deltaK1] = CORNER_DELTA[cornerIndex1];
    const gridI0 = cellX + deltaI0, gridJ0 = cellY + deltaJ0, gridK0 = cellZ + deltaK0;
    const gridI1 = cellX + deltaI1, gridJ1 = cellY + deltaJ1, gridK1 = cellZ + deltaK1;
    const edgeKeyValue = edgeKey(
      gridI0 * (resolution + 1) * (resolution + 1) + gridJ0 * (resolution + 1) + gridK0,
      gridI1 * (resolution + 1) * (resolution + 1) + gridJ1 * (resolution + 1) + gridK1
    );
    const existingVertexIndex = vertexMap.get(edgeKeyValue);
    if (existingVertexIndex !== undefined) return existingVertexIndex;

    const cornerPosition0 = [gridI0 / resolution, gridJ0 / resolution, gridK0 / resolution];
    const cornerPosition1 = [gridI1 / resolution, gridJ1 / resolution, gridK1 / resolution];
    const cornerValue0 = cornerValues[cornerIndex0], cornerValue1 = cornerValues[cornerIndex1];
    const position = interpolate(cornerPosition0, cornerPosition1, cornerValue0, cornerValue1, isovalue);

    // Surface normal (same outward convention as transvoxel.js: negate gradient of field=-SDF)
    const [gradientX, gradientY, gradientZ] = gradientAt(position[0], position[1], position[2], fieldFn);
    let gradientLength = Math.sqrt(gradientX * gradientX + gradientY * gradientY + gradientZ * gradientZ) || 1;
    const normalX = -gradientX / gradientLength, normalY = -gradientY / gradientLength, normalZ = -gradientZ / gradientLength;

    // Limit normals at edge corners for feature detection.
    const [gradient0X, gradient0Y, gradient0Z] = gradientAt(cornerPosition0[0], cornerPosition0[1], cornerPosition0[2], fieldFn);
    const [gradient1X, gradient1Y, gradient1Z] = gradientAt(cornerPosition1[0], cornerPosition1[1], cornerPosition1[2], fieldFn);
    const gradientLength0 = Math.sqrt(gradient0X * gradient0X + gradient0Y * gradient0Y + gradient0Z * gradient0Z) || 1;
    const gradientLength1 = Math.sqrt(gradient1X * gradient1X + gradient1Y * gradient1Y + gradient1Z * gradient1Z) || 1;
    const limitNormal0 = [-gradient0X / gradientLength0, -gradient0Y / gradientLength0, -gradient0Z / gradientLength0];
    const limitNormal1 = [-gradient1X / gradientLength1, -gradient1Y / gradientLength1, -gradient1Z / gradientLength1];
    const cornerNormalDotProduct = limitNormal0[0] * limitNormal1[0] + limitNormal0[1] * limitNormal1[1] + limitNormal0[2] * limitNormal1[2];

    const newVertexIndex = nextVertexIndex++;
    vertexMap.set(edgeKeyValue, newVertexIndex);
    vertices.push(position[0], position[1], position[2], normalX, normalY, normalZ);
    if (cornerNormalDotProduct < Math.cos(featureAngleRad)) vertexLimitNormals[newVertexIndex] = [limitNormal0, limitNormal1];
    else vertexLimitNormals[newVertexIndex] = undefined;
    return newVertexIndex;
  }

  function getPosition(vertexIndex) {
    return [vertices[vertexIndex * 6], vertices[vertexIndex * 6 + 1], vertices[vertexIndex * 6 + 2]];
  }
  function getNormal(vertexIndex) {
    return [vertices[vertexIndex * 6 + 3], vertices[vertexIndex * 6 + 4], vertices[vertexIndex * 6 + 5]];
  }
  function addFeatureVertex(position, normal) {
    const newVertexIndex = nextVertexIndex++;
    vertices.push(position[0], position[1], position[2], normal[0], normal[1], normal[2]);
    featureVertices.add(newVertexIndex);
    return newVertexIndex;
  }

  for (let cellZ = 0; cellZ < resolution; cellZ++) {
    for (let cellY = 0; cellY < resolution; cellY++) {
      for (let cellX = 0; cellX < resolution; cellX++) {
        const cornerValues = new Array(8);
        for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) {
          const [deltaI, deltaJ, deltaK] = CORNER_DELTA[cornerIndex];
          cornerValues[cornerIndex] = sampleField(cellX + deltaI, cellY + deltaJ, cellZ + deltaK, resolution, fieldFn);
        }
        let caseIndex = 0;
        for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) if (cornerValues[cornerIndex] > isovalue) caseIndex |= (1 << cornerIndex);
        if (caseIndex === 0 || caseIndex === 255) continue;

        const vertexArray = regularVertexData[caseIndex];
        const tableRow = regularCellPolyTable[caseIndex];
        const componentCount = tableRow[0];

        // Build per-case sample vertex indices on demand.
        const samples = new Array(12);
        let maximumVertexIndex = 0;
        let scanOffset = 1;
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
          const vertexCountInComponent = tableRow[scanOffset++];
          for (let vertexSlot = 0; vertexSlot < vertexCountInComponent; vertexSlot++) {
            const tableVertexIndex = tableRow[scanOffset + vertexSlot];
            if (tableVertexIndex > maximumVertexIndex) maximumVertexIndex = tableVertexIndex;
          }
          scanOffset += vertexCountInComponent;
        }
        for (let sampleSlot = 0; sampleSlot <= maximumVertexIndex; sampleSlot++) {
          const vertexCode = vertexArray[sampleSlot];
          samples[sampleSlot] = getVertex(cellX, cellY, cellZ, vertexCode, cornerValues);
        }

        let tableOffset = 1;
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
          const vertexCountInPolygon = tableRow[tableOffset++];
          const polygonVertexIndices = [];
          for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) polygonVertexIndices.push(samples[tableRow[tableOffset + vertexSlot]]);
          tableOffset += vertexCountInPolygon;

          // regularCellPolyTable stores open n-gons (no repeated closing vertex).
          if (vertexCountInPolygon < 3 || vertexCountInPolygon > 7) continue;

          const centerOfGravity = [0, 0, 0];
          for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) {
            const position = getPosition(polygonVertexIndices[vertexSlot]);
            centerOfGravity[0] += position[0]; centerOfGravity[1] += position[1]; centerOfGravity[2] += position[2];
          }
          centerOfGravity[0] /= vertexCountInPolygon; centerOfGravity[1] /= vertexCountInPolygon; centerOfGravity[2] /= vertexCountInPolygon;

          const positionsForDetection = [];
          const normalsForDetection = [];
          for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) {
            const polygonVertexIndex = polygonVertexIndices[vertexSlot];
            const position = getPosition(polygonVertexIndex);
            const limitNormals = vertexLimitNormals[polygonVertexIndex];
            if (limitNormals) {
              for (const limitNormal of limitNormals) {
                positionsForDetection.push([position[0] - centerOfGravity[0], position[1] - centerOfGravity[1], position[2] - centerOfGravity[2]]);
                normalsForDetection.push(limitNormal);
              }
            } else {
              positionsForDetection.push([position[0] - centerOfGravity[0], position[1] - centerOfGravity[1], position[2] - centerOfGravity[2]]);
              normalsForDetection.push(getNormal(polygonVertexIndex));
            }
          }

          const positionsForSvd = [];
          const normalsForSvd = [];
          for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) {
            const position = getPosition(polygonVertexIndices[vertexSlot]);
            positionsForSvd.push([position[0] - centerOfGravity[0], position[1] - centerOfGravity[1], position[2] - centerOfGravity[2]]);
            normalsForSvd.push(getNormal(polygonVertexIndices[vertexSlot]));
          }

          const featureResult = findFeaturePoint(positionsForDetection, normalsForDetection, featureAngleRad, counts, positionsForSvd, normalsForSvd);
          if (featureResult) {
            const worldPosition = [
              featureResult.point[0] + centerOfGravity[0],
              featureResult.point[1] + centerOfGravity[1],
              featureResult.point[2] + centerOfGravity[2]
            ];
            let averageNormalX = 0, averageNormalY = 0, averageNormalZ = 0;
            for (let vertexSlot = 0; vertexSlot < normalsForSvd.length; vertexSlot++) {
              averageNormalX += normalsForSvd[vertexSlot][0]; averageNormalY += normalsForSvd[vertexSlot][1]; averageNormalZ += normalsForSvd[vertexSlot][2];
            }
            const averageNormalLength = Math.sqrt(averageNormalX * averageNormalX + averageNormalY * averageNormalY + averageNormalZ * averageNormalZ) || 1;
            averageNormalX /= averageNormalLength; averageNormalY /= averageNormalLength; averageNormalZ /= averageNormalLength;
            const featureVertexIndex = addFeatureVertex(worldPosition, [averageNormalX, averageNormalY, averageNormalZ]);
            for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) {
              indices.push(polygonVertexIndices[vertexSlot], polygonVertexIndices[(vertexSlot + 1) % vertexCountInPolygon], featureVertexIndex);
            }
          } else {
            const triangulationTemplate = polyTable[vertexCountInPolygon];
            for (let triSlot = 0; triangulationTemplate[triSlot] !== -1; triSlot += 3) {
              indices.push(
                polygonVertexIndices[triangulationTemplate[triSlot]],
                polygonVertexIndices[triangulationTemplate[triSlot + 1]],
                polygonVertexIndices[triangulationTemplate[triSlot + 2]]
              );
            }
          }
        }
      }
    }
  }

  flipEdges(vertices, indices, featureVertices);
  console.log('Transvoxel Extended: found', counts.n_edges, 'edge features,', counts.n_corners, 'corner features');
  return { vertices, indices };
}
