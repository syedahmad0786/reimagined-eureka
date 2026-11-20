/**
 * Photo recognition for the cube scan. See docs/vision-report.md for the method and measured accuracy.
 *
 * Main path: one straight-on photo per face. CameraCapture finds the face live and takes the photo by
 * itself (or the user uses the shutter or a file), ReadoutView shows what was read with
 * classifyPartial, the user checks the outline only when it is unsure (QuadEditor), then classifyCube
 * on the six faces. Corner-shot path: two photos of opposite corners (mode 'corner', OutlineEditor,
 * cornerFaces), then classifyCube.
 */
export type { Point, Quad, FaceSample, Classification, ColourName, CornerOutline, ImageLike } from './types';
export { sampleFace, rectifyFace, faceSampleFromRgb } from './sample';
export { classifyCube, classifyPartial, COLOUR_PRIORS, UNSURE_BELOW } from './classify';
export type { ClassifyOptions, PartialClassification, PartialFace } from './classify';
export { cornerQuads, sampleCornerShot, cornerFaceletMap, assembleCornerShots, allCornerViews, isValidCornerView, cornerFaceQuads, cornerFaces, TWO_SHOT_VIEWS } from './corner';
export type { CornerView, CornerShot, CornerFace } from './corner';
export { squareToQuad, quadToSquare, applyMat3, centredSquareQuad } from './homography';
export { detectFaceQuad, detectCornerOutline, findFace, findCorner } from './detect';
export type { FaceFind, CornerFind, FindOptions, NearHint } from './detect';
export { loadImageFile, toImageData, imageDataToCanvas, snapQuad, snapOutline, locateFaceNear, WORKING_SIZE } from './load';
export { QuadEditor } from './quad-editor';
export { OutlineEditor } from './outline-editor';
export { CameraCapture, OUTLINE_SURE } from './camera';
export type { CameraCaptureOptions, CapturedFrame, CameraStatus, CameraState, CameraHintCode, CaptureMode } from './camera';
export { ReadoutView, readingFor } from './readout';
export type { ReadoutOptions, ReadoutFace, Reading } from './readout';
export { GATES, hintText, fuseSamples, faceDistance } from './live';
