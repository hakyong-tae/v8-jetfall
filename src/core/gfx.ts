// 부분 포팅: soldat-ref/soldat/shared/gfx.inc (자동생성, gfx.inc.in에서 생성 — 359개 GFX_*/GFXG_*
// 리소스 ID 상수 전체를 담은 파일). constants.ts 헤더 노트대로 이 유닛 전체는 Constants.pas
// 포팅(M1) 범위에서 제외했고, 필요해지는 모듈이 그때그때 쓰는 식별자만 여기에 추가한다.
//
// 지금 추가하는 것: weapons.ts(Weapons.pas CreateWeaponsBase, M2 Task 1)가 TGun.TextureNum/
// ClipTextureNum/BulletImageStyle/FireStyle에 대입하는 GFX_WEAPONS_* 값들 (gfx.inc 128-223행).
// 값은 렌더 매핑용 숫자 ID일 뿐 게임플레이에 영향 없음 — 원본 상수와 동일한 정수를 그대로 사용.
// 나머지 GFX_*(고스텍/인터페이스/씬어리 등)는 해당 모듈 포팅 시 추가.

export const GFX_WEAPONS_FRAG_GRENADE = 128
export const GFX_WEAPONS_AK74 = 129
export const GFX_WEAPONS_AK74_CLIP = 131
export const GFX_WEAPONS_AK74_BULLET = 134
export const GFX_WEAPONS_AK74_FIRE = 135
export const GFX_WEAPONS_MINIMI = 136
export const GFX_WEAPONS_MINIMI_CLIP = 138
export const GFX_WEAPONS_MINIMI_BULLET = 141
export const GFX_WEAPONS_MINIMI_FIRE = 142
export const GFX_WEAPONS_RUGER = 143
export const GFX_WEAPONS_RUGER_BULLET = 146
export const GFX_WEAPONS_RUGER_FIRE = 147
export const GFX_WEAPONS_MP5 = 148
export const GFX_WEAPONS_MP5_CLIP = 150
export const GFX_WEAPONS_MP5_BULLET = 153
export const GFX_WEAPONS_MP5_FIRE = 154
export const GFX_WEAPONS_SPAS = 155
export const GFX_WEAPONS_SPAS_FIRE = 159
export const GFX_WEAPONS_M79 = 160
export const GFX_WEAPONS_M79_CLIP = 162
export const GFX_WEAPONS_M79_FIRE = 166
export const GFX_WEAPONS_DEAGLES = 167
export const GFX_WEAPONS_DEAGLES_CLIP = 171
export const GFX_WEAPONS_DEAGLES_BULLET = 174
export const GFX_WEAPONS_DEAGLES_FIRE = 175
export const GFX_WEAPONS_STEYR = 176
export const GFX_WEAPONS_STEYR_CLIP = 178
export const GFX_WEAPONS_STEYR_BULLET = 181
export const GFX_WEAPONS_STEYR_FIRE = 182
export const GFX_WEAPONS_BARRETT = 183
export const GFX_WEAPONS_BARRETT_CLIP = 185
export const GFX_WEAPONS_BARRETT_BULLET = 188
export const GFX_WEAPONS_BARRETT_FIRE = 189
export const GFX_WEAPONS_MINIGUN = 190
export const GFX_WEAPONS_MINIGUN_BULLET = 194
export const GFX_WEAPONS_MINIGUN_FIRE = 195
export const GFX_WEAPONS_SOCOM = 196
export const GFX_WEAPONS_SOCOM_CLIP = 200
export const GFX_WEAPONS_COLT_BULLET = 203
export const GFX_WEAPONS_SOCOM_FIRE = 204
export const GFX_WEAPONS_BOW = 205
export const GFX_WEAPONS_BOW_S = 207
export const GFX_WEAPONS_BOW_FIRE = 212
export const GFX_WEAPONS_FLAMER = 213
export const GFX_WEAPONS_FLAMER_FIRE = 215
export const GFX_WEAPONS_KNIFE = 216
export const GFX_WEAPONS_CHAINSAW = 218
export const GFX_WEAPONS_CHAINSAW_FIRE = 220
export const GFX_WEAPONS_LAW = 221
export const GFX_WEAPONS_LAW_FIRE = 223
