import * as THREE from "three";

const commonVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const encodeDecodeGLSL = /* glsl */ `
  vec3 encodeId(float id) {
    float r = mod(id, 256.0);
    float g = mod(floor(id / 256.0), 256.0);
    float b = mod(floor(id / 65536.0), 256.0);
    return vec3(r, g, b) / 255.0;
  }

  float decodeId(vec3 encoded) {
    vec3 scaled = floor(encoded * 255.0 + 0.5);
    return scaled.r + (scaled.g * 256.0) + (scaled.b * 65536.0);
  }
`;

export function alphaIdMaterial(id: number) {
  return new THREE.ShaderMaterial({
    vertexShader: commonVertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uId;
      ${encodeDecodeGLSL}

      void main() {
        gl_FragColor = vec4(encodeId(uId), 1.0);
      }
    `,
    uniforms: {
      uId: { value: id },
    },
  });
}

export function alphaFilterMaterial(
  id: number,
  idTexture: THREE.Texture,
  colorTexture: THREE.Texture,
  drawOnZero = false,
) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: commonVertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform float uId;
      uniform float uDrawOnZero;
      uniform sampler2D tIdTexture;
      uniform sampler2D tColorTexture;
      ${encodeDecodeGLSL}

      void main() {
        float decodedId = decodeId(texture2D(tIdTexture, vUv).rgb);
        vec4 color = texture2D(tColorTexture, vUv);

        if (decodedId < 0.5) {
          if (uDrawOnZero > 0.5) {
            gl_FragColor = vec4(color.rgb, 1.0);
          } else {
            discard;
          }
          return;
        }

        if (abs(decodedId - uId) > 0.5) {
          discard;
          return;
        }

        gl_FragColor = vec4(color.rgb, 1.0);
      }
    `,
    uniforms: {
      uId: { value: id },
      uDrawOnZero: { value: drawOnZero ? 1 : 0 },
      tIdTexture: { value: idTexture },
      tColorTexture: { value: colorTexture },
    },
  });
}
