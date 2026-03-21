Shader "StreetViewVR/PanoramaSphere"
{
    // Custom shader for rendering equirectangular panorama textures on an inside-out sphere.
    // Features:
    //   - Single-pass instanced stereo rendering for VR (Quest 3 / OpenXR)
    //   - Back-face culling disabled (renders inner surface)
    //   - sRGB-correct sampling
    //   - Fade/alpha support for cross-fade transitions

    Properties
    {
        _MainTex  ("Panorama Texture", 2D) = "white" {}
        _Color    ("Tint Color",     Color) = (1,1,1,1)
        _Exposure ("Exposure",       Range(0.5, 2.0)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "Queue"      = "Background"
        }

        // Disable backface culling → visible from inside the sphere
        Cull   Off
        ZWrite Off
        Blend  SrcAlpha OneMinusSrcAlpha

        Pass
        {
            HLSLPROGRAM
            #pragma vertex   vert
            #pragma fragment frag

            // Enable single-pass instanced stereo for Quest 3
            #pragma multi_compile_instancing
            #pragma multi_compile _ UNITY_SINGLE_PASS_STEREO

            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv     : TEXCOORD0;

                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv  : TEXCOORD0;

                UNITY_VERTEX_OUTPUT_STEREO
            };

            sampler2D _MainTex;
            float4    _MainTex_ST;
            float4    _Color;
            float     _Exposure;

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv  = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);

                fixed4 col = tex2D(_MainTex, i.uv) * _Color;
                col.rgb   *= _Exposure;
                return col;
            }
            ENDHLSL
        }
    }

    FallBack "Unlit/Texture"
}
