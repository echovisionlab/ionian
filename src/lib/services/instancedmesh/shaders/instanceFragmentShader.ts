export default `
varying vec2 vUv;

uniform sampler2D uOriginTexture;
uniform sampler2D uDestinationTexture;

uniform float uProgress;
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
    vec3 viewDir = normalize( vViewPosition );
    vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
    vec3 y = cross( viewDir, x );
    vec2 uv = vec2( dot( x, vNormal ), dot( y, vNormal ) ) * 0.495 + 0.5; // 0.495 to remove artifacts caused by undersized matcap disks

    vec4 textureA = texture2D( uOriginTexture, uv );
    vec4 textureB = texture2D( uDestinationTexture, uv );

    vec4 finalColor = mix(textureA, textureB, uProgress);
    gl_FragColor = finalColor;
}
`;
