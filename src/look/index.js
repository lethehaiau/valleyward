// VALLEYWARD · the look (the render path) · dispatches to the active edition's look (decision 0001):
// src/gfx/webgl2/look.js (WebGLRenderer, GLSL passes) or src/gfx/webgpu/look.js (WebGPURenderer, TSL passes). Both have
// the same API (render, setFluidPass, setViewmodel, flash, setHurt, setDawn, setExposure, setTone, setSize,
// setResolutionScale, warm, dispose, depthTexture, grade, …). The mood shared by both lives in ./mood.js.
import { gfx } from '../gfx/current.js';

/** @param {{ renderer: any, scene: any, camera: any, quality?: 'high'|'medium'|'low' }} o */
export function createLook(o) { return gfx().createLook(o); }
