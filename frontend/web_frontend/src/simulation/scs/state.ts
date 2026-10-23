type GLState = {
  stencilTest?: boolean;
  depthTest?: boolean;
  faceCulling?: boolean;
  cullFace?: number;
  stencilOp?: [number, number, number];
  stencilFunc?: [number, number, number];
  stencilMask?: number;
  depthFunc?: number;
  depthMask?: boolean;
  colorMask?: [boolean, boolean, boolean, boolean];
};

type GLStateKey = keyof GLState;
type GLStateValue = Required<GLState>[GLStateKey];

const GL = WebGLRenderingContext;

const defaultGLState: Required<GLState> = {
  stencilTest: false,
  depthTest: true,
  faceCulling: true,
  cullFace: GL.BACK,
  stencilOp: [GL.KEEP, GL.KEEP, GL.KEEP],
  stencilMask: 0x00,
  stencilFunc: [GL.ALWAYS, 0x00, 0x00],
  depthFunc: GL.LESS,
  depthMask: true,
  colorMask: [true, true, true, true],
};

const glPropSetters: Record<GLStateKey, (gl: WebGLRenderingContext, value: GLStateValue) => void> = {
  stencilTest: (gl, value) =>
    value ? gl.enable(gl.STENCIL_TEST) : gl.disable(gl.STENCIL_TEST),
  depthTest: (gl, value) =>
    value ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST),
  faceCulling: (gl, value) =>
    value ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE),
  cullFace: (gl, value) => gl.cullFace(value as number),
  stencilOp: (gl, value) => {
    const [a, b, c] = value as [number, number, number];
    gl.stencilOp(a, b, c);
  },
  stencilFunc: (gl, value) => {
    const [a, b, c] = value as [number, number, number];
    gl.stencilFunc(a, b, c);
  },
  stencilMask: (gl, value) => gl.stencilMask(value as number),
  depthFunc: (gl, value) => gl.depthFunc(value as number),
  depthMask: (gl, value) => gl.depthMask(value as boolean),
  colorMask: (gl, value) => {
    const [a, b, c, d] = value as [boolean, boolean, boolean, boolean];
    gl.colorMask(a, b, c, d);
  },
};

function isPropEqual<Key extends GLStateKey>(
  state: Required<GLState>,
  key: Key,
  value: Required<GLState>[Key],
) {
  const currentValue = state[key];

  if (Array.isArray(currentValue) && Array.isArray(value)) {
    return currentValue.every((entry, index) => entry === value[index]);
  }

  return currentValue === value;
}

function applyState(gl: WebGLRenderingContext, state: Required<GLState>) {
  (Object.keys(defaultGLState) as GLStateKey[]).forEach((key) => {
    glPropSetters[key](gl, state[key]);
  });
}

export class State {
  private readonly gl: WebGLRenderingContext;
  private state: Required<GLState>;
  private readonly stack: Required<GLState>[] = [];

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.state = { ...defaultGLState };
    applyState(gl, this.state);
  }

  set(props: GLState) {
    let nextState = this.state;

    (Object.keys(props) as GLStateKey[]).forEach((key) => {
      const value = props[key];
      if (value === undefined) {
        return;
      }

      const resolvedValue = value as Required<GLState>[typeof key];
      if (isPropEqual(nextState, key, resolvedValue)) {
        return;
      }

      nextState = {
        ...nextState,
        [key]: Array.isArray(resolvedValue) ? [...resolvedValue] : resolvedValue,
      } as Required<GLState>;
      glPropSetters[key](this.gl, resolvedValue);
    });

    this.state = nextState;
  }

  push() {
    this.stack.push({ ...this.state });
  }

  pop() {
    const previousState = this.stack.pop();
    if (!previousState) {
      return;
    }

    this.state = previousState;
    applyState(this.gl, this.state);
  }

  reset() {
    this.state = { ...defaultGLState };
    applyState(this.gl, this.state);
  }
}
