/**
 * Photo recognition for the cube scan. See docs/vision-report.md for the method and measured accuracy.
 *
 * Main path: one straight-on photo per face (CameraCapture or loadImageFile + detectFaceQuad), the
 * user checks the outline (QuadEditor), then sampleFace per face and classifyCube on the six faces.
 * Corner-shot path: two photos of opposite corners (detectCornerOutline, OutlineEditor,
 * sampleCornerShot, assembleCornerShots), then classifyCube.
 */
export type { Point, Quad, FaceSample, Classification, ColourName, CornerOutline, ImageLike } from './types';
export { sampleFace, rectifyFace, faceSampleFromRgb } from './sample';
export { classifyCube, COLOUR_PRIORS } from './classify';
export type { ClassifyOptions } from './classify';
export { cornerQuads, sampleCornerShot, cornerFaceletMap, assembleCornerShots, allCornerViews, isValidCornerView, TWO_SHOT_VIEWS } from './corner';
export type { CornerView, CornerShot } from './corner';
export { squareToQuad, quadToSquare, applyMat3, centredSquareQuad } from './homography';
export { detectFaceQuad, detectCornerOutline } from './detect';
export { loadImageFile, toImageData, imageDataToCanvas, snapQuad, snapOutline, locateFaceNear, WORKING_SIZE } from './load';
export { QuadEditor } from './quad-editor';
export { OutlineEditor } from './outline-editor';
export { CameraCapture } from './camera';
export type { CameraCaptureOptions, CapturedFrame } from './camera';
