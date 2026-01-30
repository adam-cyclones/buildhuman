// MatCap + Directional lighting shader for human editing
// Vertex format: position (vec3) + normal (vec3) = 6 floats

struct CameraUniform {
    view_proj: mat4x4<f32>,
    view: mat4x4<f32>,
    camera_pos: vec3<f32>,
    _padding: f32,
};

struct LightUniform {
    direction: vec3<f32>,
    _padding1: f32,
    color: vec3<f32>,
    _padding2: f32,
    ambient: vec3<f32>,
    _padding3: f32,
};

@group(0) @binding(0)
var<uniform> camera: CameraUniform;

@group(0) @binding(1)
var<uniform> light: LightUniform;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) view_normal: vec3<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // Transform position through view-projection matrix
    output.clip_position = camera.view_proj * vec4<f32>(input.position, 1.0);
    output.world_pos = input.position;
    output.world_normal = input.normal;
    output.view_normal = (camera.view * vec4<f32>(input.normal, 0.0)).xyz;

    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let N = normalize(input.world_normal);
    let V = normalize(camera.camera_pos - input.world_pos);
    let view_N = normalize(input.view_normal);

    // === MatCap simulation (procedural) ===
    let matcap_base = vec3<f32>(0.75, 0.72, 0.68);
    let matcap_shadow = vec3<f32>(0.35, 0.32, 0.30);
    let matcap_highlight = vec3<f32>(0.95, 0.93, 0.90);

    let matcap_t = view_N.y * 0.5 + 0.5;
    var matcap = mix(matcap_shadow, matcap_base, smoothstep(0.0, 0.5, matcap_t));
    matcap = mix(matcap, matcap_highlight, smoothstep(0.5, 1.0, matcap_t));

    // Rim highlight
    let rim_x = abs(view_N.x);
    matcap = mix(matcap, matcap_highlight * 0.9, smoothstep(0.7, 1.0, rim_x) * 0.3);

    // === Directional Light ===
    let NdotL = max(dot(N, -light.direction), 0.0);
    let diffuse = light.color * NdotL;

    // === Fresnel rim ===
    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    let rim = vec3<f32>(0.4, 0.45, 0.5) * fresnel;

    // === Combine ===
    var color = matcap * 0.6 + (diffuse + light.ambient) * 0.4;
    color = color + rim * 0.3;

    // Tone mapping + gamma
    color = color / (color + vec3<f32>(1.0));
    color = pow(color, vec3<f32>(1.0 / 2.2));

    return vec4<f32>(color, 1.0);
}
