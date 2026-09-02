export default `
varying vec2 vUv;
uniform sampler2D uTexture;
uniform sampler2D uVelocity;
uniform float uTime;
varying vec3 vNormal;
attribute vec2 uvRef;
varying vec3 vViewPosition;

vec3 rotate3D(vec3 v, vec3 vel) {
    vec3 pos = v;
    vec3 up = vec3(0, 1, 0);
    vec3 axis = normalize(cross(up, vel));
    float angle = acos(dot(up, normalize(vel)));
    pos = pos * cos(angle) + cross(axis, pos) * sin(angle) + axis * dot(axis, pos) * (1. - cos(angle));
    return pos;
}

void main() {
    vUv = uv;
    vNormal = normal;

    vec4 color = texture2D(uTexture, uvRef);
    vec4 velocity = texture2D(uVelocity, uvRef);
    vec3 pos = color.xyz;// apply the texture to the vertex distribution.

    vec3 localPosition = position.xyz;
    if (length (velocity.xyz) < 0.0001) {
        velocity.xyz = vec3(0.0, 0.0001, 0.0001);
    }
    localPosition.y *= max(1.0, length(velocity.xyz) * 1000.0);
    localPosition = rotate3D(localPosition, velocity.xyz);
    vNormal = rotate3D(normal, velocity.xyz);

    mat4 instanceMat = instanceMatrix;
    instanceMat[3].xyz = pos.xyz;

    // unlike the traditional mvMatrix * position, we need to additional multiplication with the instance matrix.
    vec4 modelViewPosition = modelViewMatrix * instanceMat * vec4(localPosition, 1.0);

    vViewPosition = - modelViewPosition.xyz;

    gl_Position = projectionMatrix * modelViewPosition;
}
`;
