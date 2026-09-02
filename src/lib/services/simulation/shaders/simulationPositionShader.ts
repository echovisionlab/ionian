export default `
uniform vec4 uInteractionPosition;
uniform float uTime;
uniform float uTractionForce;
uniform sampler2D uPositionAtlas;
uniform float uOverallProgress; // (0.0 to 1.0)
uniform int uNumMeshes;
uniform float uSingleTextureSize;

float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

// Helper function to get position from atlas
vec3 getAtlasPosition(vec2 uv, int meshIndex) {
    float atlasWidth = uSingleTextureSize * float(uNumMeshes);
    float atlasHeight = uSingleTextureSize; // Assuming height is single texture size

    // Calculate UV within the specific mesh's section of the atlas
    float segmentWidthRatio = uSingleTextureSize / atlasWidth;
    vec2 atlasUV = vec2(
        uv.x * segmentWidthRatio + segmentWidthRatio * float(meshIndex),
        uv.y // Assuming vertical layout doesn't change y
    );

    return texture2D(uPositionAtlas, atlasUV).xyz;
}

void main() {
    // GPGPU UV calculation
    vec2 uv = gl_FragCoord.xy / resolution.xy; // resolution is the size of the *output* texture (e.g., 256x256)

    vec3 currentPosition = texture2D(uCurrentPosition, uv).xyz;
    vec3 currentVelocity = texture2D(uCurrentVelocity, uv).xyz;

    // --- Calculate Target Position from Atlas ---
    vec3 targetPosition;
    if (uNumMeshes <= 1) {
        targetPosition = getAtlasPosition(uv, 0);
    } else {
        float totalSegments = float(uNumMeshes - 1);
        float progressPerSegment = 1.0 / totalSegments;
        float scaledProgress = uOverallProgress * totalSegments;

        int indexA = int(floor(scaledProgress));
        // Clamp indexB to avoid going out of bounds
        int indexB = min(indexA + 1, uNumMeshes - 1);

        // Ensure indexA is also within bounds (important if uOverallProgress is exactly 1.0)
        indexA = min(indexA, uNumMeshes - 1);


        float localProgress = fract(scaledProgress);

        // Handle edge case where progress is exactly 1.0
        if (uOverallProgress == 1.0) {
             indexA = uNumMeshes - 1;
             indexB = uNumMeshes - 1;
             localProgress = 1.0; // or 0.0 depending on how you want to handle it
        }


        vec3 positionA = getAtlasPosition(uv, indexA);
        vec3 positionB = getAtlasPosition(uv, indexB);

        targetPosition = mix(positionA, positionB, localProgress);
    }
    // --- End Target Position Calculation ---

    // Particle attraction to target position
    vec3 direction = normalize(targetPosition - currentPosition);
    float dist = length(targetPosition - currentPosition);

    vec3 finalPosition = currentPosition;

    // Apply attraction force (simplified mix)
    if (dist > 0.01) { // Only apply if significantly far
       finalPosition = mix(currentPosition, targetPosition, 0.1 * uTractionForce);
    }

    finalPosition += currentVelocity;
    gl_FragColor = vec4(finalPosition, 1.0);
}
`;
