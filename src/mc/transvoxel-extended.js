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

/**
 * Feature detection per Kobbelt et al. "Feature Sensitive Surface Extraction from Volume Data".
 * θ = min_{i,j}(n_i·n_j); sharp feature when θ < cos(featureAngleRad).
 * n* = (n0×n1) normalized; φ = max_i |n_i·n*|; corner when φ > sin(cornerAngleRad), else edge.
 * Angles in radians (defaults: featureAngleRad=0.9, cornerAngleRad=0.7).
 */
function findFeaturePoint(positionsCentered, normals, featureAngleRad, cornerAngleRad, counts) {
  const vertexCount = positionsCentered.length;
  let theta = 1;
  let n0 = [0, 0, 0];
  let n1 = [0, 0, 0];
  for (let i = 0; i < vertexCount; i++) {
    for (let j = 0; j < vertexCount; j++) {
      const dot = normals[i][0] * normals[j][0] + normals[i][1] * normals[j][1] + normals[i][2] * normals[j][2];
      if (dot < theta) {
        theta = dot;
        n0 = normals[i].slice(0, 3);
        n1 = normals[j].slice(0, 3);
      }
    }
  }
  const cosSharp = Math.cos(featureAngleRad);
  if (theta > cosSharp) return null;

  const nStar = [
    n0[1] * n1[2] - n0[2] * n1[1],
    n0[2] * n1[0] - n0[0] * n1[2],
    n0[0] * n1[1] - n0[1] * n1[0]
  ];
  const nStarLen = Math.sqrt(nStar[0] * nStar[0] + nStar[1] * nStar[1] + nStar[2] * nStar[2]) || 1;
  nStar[0] /= nStarLen; nStar[1] /= nStarLen; nStar[2] /= nStarLen;

  let phi = 0;
  for (let i = 0; i < vertexCount; i++) {
    const d = Math.abs(normals[i][0] * nStar[0] + normals[i][1] * nStar[1] + normals[i][2] * nStar[2]);
    if (d > phi) phi = d;
  }
  const cornerThreshold = Math.sin(cornerAngleRad);
  const rank = phi > cornerThreshold ? 3 : 2;
  if (rank === 2) counts.n_edges++;
  else counts.n_corners++;

  const matrixA = [];
  const vectorB = [];
  for (let i = 0; i < vertexCount; i++) {
    matrixA.push([normals[i][0], normals[i][1], normals[i][2]]);
    vectorB.push(positionsCentered[i][0] * normals[i][0] + positionsCentered[i][1] * normals[i][1] + positionsCentered[i][2] * normals[i][2]);
  }

  const point = svdSolve3(matrixA, vectorB, rank === 2);
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(point[2])) return null;
  let minP = [positionsCentered[0][0], positionsCentered[0][1], positionsCentered[0][2]];
  let maxP = [positionsCentered[0][0], positionsCentered[0][1], positionsCentered[0][2]];
  for (let i = 1; i < vertexCount; i++) {
    for (let d = 0; d < 3; d++) {
      if (positionsCentered[i][d] < minP[d]) minP[d] = positionsCentered[i][d];
      if (positionsCentered[i][d] > maxP[d]) maxP[d] = positionsCentered[i][d];
    }
  }
  const margin = 0.1;
  for (let d = 0; d < 3; d++) {
    if (point[d] < minP[d] - margin || point[d] > maxP[d] + margin) return null;
  }
  // Reject degenerate polygon (zero extent) so we don't place a feature at a single point
  const extent = Math.max(maxP[0] - minP[0], maxP[1] - minP[1], maxP[2] - minP[2]);
  if (extent < 1e-10) return null;
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

/**
It searches for this pattern:

two triangles share an edge
the two vertices opposite that shared edge are both feature vertices
the shared edge’s endpoints are not feature vertices
When that happens, it replaces the shared edge with the edge between the two feature vertices.

Before:
Triangle 0: (A, B, C)
Triangle 1: (A, B, D)

        C (oppositeVertex0)
        /\
       /  \
      /    \
     A------B
      \    /
       \  /
        \/
        D (oppositeVertex1)

After:

Triangle 0: (A, C, D)
Triangle 1: (B, D, C)

      C (oppositeVertex0)
     /|\
    / | \
   /  |  \
  A   |   B
   \  |  /
    \ | /
     \|/
      D (oppositeVertex1)

 */
function flipEdges(vertices, indices, featureVertices) {
  const makeEdgeKey = (vertexA, vertexB) => (vertexA < vertexB ? `${vertexA},${vertexB}` : `${vertexB},${vertexA}`);

  // Build a map: edge key -> list of triangles that use that edge (each with triangleOffset, edge vertices, opposite vertex)
  //an edge key is (smallerAbsoluteVertexIndex, largerAbsoluteVertexIndex)
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
    if (triangleList.length !== 2) continue;  // Only flip edges shared by exactly two triangles (manifold)
    const [triangle0, triangle1] = triangleList;
    const edgeVertexA = triangle0.edgeVertexU, edgeVertexB = triangle0.edgeVertexV;
    const oppositeVertex0 = triangle0.oppositeVertex, oppositeVertex1 = triangle1.oppositeVertex;

    // Flip only when both opposite vertices are feature vertices (connect the two features)
    if (!featureVertices.has(oppositeVertex0) || !featureVertices.has(oppositeVertex1)) continue;
    // Do not flip if either edge endpoint is a feature (would disconnect a feature from the fan)
    if (featureVertices.has(edgeVertexA) || featureVertices.has(edgeVertexB)) continue;

    // Avoid creating a duplicate edge: if the flipped edge (opposite0–opposite1) already exists elsewhere, skip
    const flippedEdgeKey = makeEdgeKey(oppositeVertex0, oppositeVertex1);
    if (flippedEdgeKey !== edgeKeyString && edgeToTriangles.has(flippedEdgeKey)) continue;

    // Skip if either new triangle would be degenerate (area below threshold)
    if (triArea(vertices, edgeVertexA, oppositeVertex0, oppositeVertex1) < minimumArea) continue;
    if (triArea(vertices, edgeVertexB, oppositeVertex1, oppositeVertex0) < minimumArea) continue;

    // Perform the flip: replace edge A–B with edge opposite0–opposite1
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
 * @param {{ featureAngleRad?: number, cornerAngleRad?: number, flipEdges?: boolean, noFeatures?: boolean }} options - featureAngleRad/cornerAngleRad in radians (defaults 0.9, 0.7); flipEdges (default true); noFeatures=true disables sharp features
 * @returns {{ vertices:number[], indices:number[] }}
 */
export function runTransvoxelExtended(resolution, isovalue, fieldFn, options = {}) {
  const featureAngleRad = options.featureAngleRad ?? 0.9;
  const cornerAngleRad = options.cornerAngleRad ?? 0.7;
  const noFeatures = options.noFeatures === true;

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

        // 12 vertex slots per cell (like MC extended 12 edges); table indices reference these.
        // Do not create vertices for 0x0000 (padding): that would create degenerate corner vertices
        // and can cause triangles to connect across the grid when indices are reused incorrectly.
        const samples = new Array(12);
        const INVALID_SLOT = -1;
        for (let sampleSlot = 0; sampleSlot < 12; sampleSlot++) {
          const vertexCode = vertexArray[sampleSlot];
          if (vertexCode === 0) {
            samples[sampleSlot] = INVALID_SLOT;
            continue;
          }
          samples[sampleSlot] = getVertex(cellX, cellY, cellZ, vertexCode, cornerValues);
        }

        let tableOffset = 1;
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
          const vertexCountInPolygon = tableRow[tableOffset++];
          const polygonVertexIndices = [];
          let skipComponent = false;
          for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) {
            const idx = samples[tableRow[tableOffset + vertexSlot]];
            if (idx === INVALID_SLOT) {
              skipComponent = true;
              break;
            }
            polygonVertexIndices.push(idx);
          }
          tableOffset += vertexCountInPolygon;
          if (skipComponent) continue;

          const centerOfGravity = [0, 0, 0];
          for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) {
            const position = getPosition(polygonVertexIndices[vertexSlot]);
            centerOfGravity[0] += position[0]; centerOfGravity[1] += position[1]; centerOfGravity[2] += position[2];
          }
          centerOfGravity[0] /= vertexCountInPolygon; centerOfGravity[1] /= vertexCountInPolygon; centerOfGravity[2] /= vertexCountInPolygon;

          const positionsCentered = [];
          const normals = [];
          for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) {
            const position = getPosition(polygonVertexIndices[vertexSlot]);
            positionsCentered.push([position[0] - centerOfGravity[0], position[1] - centerOfGravity[1], position[2] - centerOfGravity[2]]);
            normals.push(getNormal(polygonVertexIndices[vertexSlot]));
          }

          const featureResult = noFeatures ? null : findFeaturePoint(positionsCentered, normals, featureAngleRad, cornerAngleRad, counts);
          let worldPosition = null;
          let useFeatureVertex = false;
          if (featureResult) {
            worldPosition = [
              featureResult.point[0] + centerOfGravity[0],
              featureResult.point[1] + centerOfGravity[1],
              featureResult.point[2] + centerOfGravity[2]
            ];
            // Avoid placing a feature vertex at origin (triangles "shooting to origin" at e.g. res 34, 6x6 cubes)
            const atOrigin = Math.abs(worldPosition[0]) < 1e-10 && Math.abs(worldPosition[1]) < 1e-10 && Math.abs(worldPosition[2]) < 1e-10;
            useFeatureVertex = !atOrigin;
          }
          if (useFeatureVertex && worldPosition) {
            let averageNormalX = 0, averageNormalY = 0, averageNormalZ = 0;
            for (let vertexSlot = 0; vertexSlot < normals.length; vertexSlot++) {
              averageNormalX += normals[vertexSlot][0]; averageNormalY += normals[vertexSlot][1]; averageNormalZ += normals[vertexSlot][2];
            }
            const averageNormalLength = Math.sqrt(averageNormalX * averageNormalX + averageNormalY * averageNormalY + averageNormalZ * averageNormalZ) || 1;
            averageNormalX /= averageNormalLength; averageNormalY /= averageNormalLength; averageNormalZ /= averageNormalLength;
            const featureVertexIndex = addFeatureVertex(worldPosition, [averageNormalX, averageNormalY, averageNormalZ]);
            for (let vertexSlot = 0; vertexSlot < vertexCountInPolygon; vertexSlot++) {
              indices.push(polygonVertexIndices[vertexSlot], polygonVertexIndices[(vertexSlot + 1) % vertexCountInPolygon], featureVertexIndex);
            }
          } else {
            // No feature or rejected (e.g. at origin): fan triangulation from polyTable
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

  const flipEdgesOption = options.flipEdges === true; // only flip when explicitly true
  if (flipEdgesOption) flipEdges(vertices, indices, featureVertices);
  console.log('Transvoxel Extended: found', counts.n_edges, 'edge features,', counts.n_corners, 'corner features');
  return { vertices, indices };
}
