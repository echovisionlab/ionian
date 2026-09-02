export default `
uniform sampler2D uPositionA;
uniform sampler2D uPositionB;
uniform float uProgress;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 positionA = texture2D(uPositionA, uv).xyz;
    vec3 positionB = texture2D(uPositionB, uv).xyz;
    vec3 mixedPosition = mix(positionA, positionB, uProgress);
    gl_FragColor = vec4(mixedPosition, 1.0);
}
`;
