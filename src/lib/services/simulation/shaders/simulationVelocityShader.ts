export default `
uniform vec4 uInteractionPosition;
uniform float uTime;
uniform float uTractionForce;
uniform float uMaxRepelDistance;
uniform sampler2D uPositionAtlas;
uniform float uOverallProgress;
uniform int uNumMeshes;
uniform float uSingleTextureSize;

float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

// Helper function (same as in position shader)
vec3 getAtlasPosition(vec2 uv, int meshIndex) {
    float atlasWidth = uSingleTextureSize * float(uNumMeshes);
    float atlasHeight = uSingleTextureSize;
    float segmentWidthRatio = uSingleTextureSize / atlasWidth;
    vec2 atlasUV = vec2(uv.x * segmentWidthRatio + segmentWidthRatio * float(meshIndex), uv.y);
    return texture2D(uPositionAtlas, atlasUV).xyz;
}

void main() {
   vec2 uv = gl_FragCoord.xy / resolution.xy;
    float offset = rand(uv);

    vec3 currentPosition = texture2D(uCurrentPosition, uv).xyz;
    vec3 currentVelocity = texture2D(uCurrentVelocity, uv).xyz;

    // --- Calculate Target Position from Atlas (same logic as position shader) ---
    vec3 targetPosition;
     if (uNumMeshes <= 1) {
        targetPosition = getAtlasPosition(uv, 0);
    } else {
        float totalSegments = float(uNumMeshes - 1);
        float progressPerSegment = 1.0 / totalSegments;
        float scaledProgress = uOverallProgress * totalSegments;
        int indexA = int(floor(scaledProgress));
        int indexB = min(indexA + 1, uNumMeshes - 1);
        indexA = min(indexA, uNumMeshes - 1);
        float localProgress = fract(scaledProgress);
         if (uOverallProgress == 1.0) {
             indexA = uNumMeshes - 1;
             indexB = uNumMeshes - 1;
             localProgress = 1.0;
        }
        vec3 positionA = getAtlasPosition(uv, indexA);
        vec3 positionB = getAtlasPosition(uv, indexB);
        targetPosition = mix(positionA, positionB, localProgress);
    }
    // --- End Target Position Calculation ---

    vec3 finalVelocity = currentVelocity * 0.9; // Dampening

    // Particle traction force towards target (influences velocity)
    vec3 direction = normalize(targetPosition - currentPosition);
    float dist = length(targetPosition - currentPosition);
    if (dist > 0.01) {
        // Add force proportional to distance and traction setting
        finalVelocity += direction * dist * 0.01 * uTractionForce; // Adjust multiplier as needed
    }

    // Mouse repel force
    if (uInteractionPosition.w > 0.0) { // Check if interaction is active (w component)
        float pointerDistance = distance(currentPosition, uInteractionPosition.xyz);
        if (pointerDistance < uMaxRepelDistance) {
            float mouseRepelModifier = smoothstep(uMaxRepelDistance, 0.0, pointerDistance); // Smoother falloff
            vec3 repelDirection = normalize(currentPosition - uInteractionPosition.xyz);
            // Apply force based on proximity and interaction strength (w)
            finalVelocity += repelDirection * mouseRepelModifier * uInteractionPosition.w * 0.01; // Adjust multiplier
        }
    }

    // Optional: Reset position if particle "dies" and respawns (lifespan logic)
    float lifespan = 20.0;
    float age = mod(uTime * 0.1 + lifespan * offset, lifespan); // Adjust time scale
    if (age < 0.05) { // Small window for reset
        finalVelocity = vec3(0.0); // Reset velocity on respawn
        // Note: Resetting position directly here might cause jumps.
        // It's often better handled in the position shader or by ensuring
        // strong attraction force when dist is large.
    }


    gl_FragColor = vec4(finalVelocity, 1.0);
}
`;
