// 1:1 포팅: soldat-ref/soldat/shared/Constants.pas (587 lines)
// Constants Unit — Copyright (c) 2011 Gregor A. Cieslak
//
// 이 포트는 CLIENT 빌드 기준이다. {$IFDEF SERVER}로만 존재하는 상수는 제외했다
// (예: MAX_GAME_WIDTH). 같은 이름이 SERVER/CLIENT에서 다른 값을 갖는 경우
// CLIENT 값을 내보내고 `TODO(M3) SERVER: <value>` 주석을 남긴다 (예: MAX_PUSHTICK).
//
// 원본은 `{$INCLUDE gfx.inc}`로 GFX_*/GFXG_* 상수(스프라이트 리소스 ID, 359개)를
// 이 유닛에 텍스트로 삽입하지만, gfx.inc는 별도 자동생성 파일(gfx.inc.in에서 생성)이고
// 스프라이트 리소스 로딩과 결합된 관심사이므로 이 태스크(Constants.pas 587줄) 범위에서는
// 제외했다. sprites 모듈 포팅 시 별도 파일(예: gfx.ts)로 다룰 것.

export const DEFAULT_FONT = 'play-regular.ttf'

export const HEADSTYLE_NONE = 0
export const HEADSTYLE_HELMET = 1
export const HEADSTYLE_HAT = 2

export const DEFAULT_WIDTH = 640
export const DEFAULT_HEIGHT = 480

export const DEFAULT_GOALTICKS = 60

export const SCALE = 3

export const MAX_FOV = 1.78
// {$IFDEF SERVER} MAX_GAME_WIDTH = 480 * MAX_FOV; {$ENDIF} — server-only, omitted for client build.
// TODO(M3) SERVER: MAX_GAME_WIDTH = 480 * MAX_FOV (= 854.4)
export const MIN_FOV = 1.25
export const MAX_BIG_MESSAGES = 255

// speeds
export const RUNSPEED = 0.118
export const RUNSPEEDUP = RUNSPEED / 6
export const FLYSPEED = 0.03
export const JUMPSPEED = 0.66
export const CROUCHRUNSPEED = RUNSPEED / 0.6
export const PRONESPEED = RUNSPEED * 4.0
export const ROLLSPEED = RUNSPEED / 1.2
export const JUMPDIRSPEED = 0.3
export const JETSPEED = 0.1
export const CAMSPEED = 0.14

export const CLUSTER_GRENADES = 3

// aimdistances
export const DEFAULTAIMDIST = 7
export const SNIPERAIMDIST = 3.5
export const CROUCHAIMDIST = 4.5
export const SPECTATORAIMDIST = 30
export const AIMDISTINCR = 0.05

export const BULLETCHECKARRAYSIZE = 20
export const MAX_LOGFILESIZE = 512000
export const SOUND_MAXDIST = 750
export const SOUND_PANWIDTH = 1000
export const SOUND_METERLENGTH = 2000

// trails
export const BULLETTRAIL = 13
export const M79TRAIL = 6

// {$IFNDEF SERVER} — client-only, no server value exists.
export const BULLETLENGTH = 21

// healths
export const DEFAULT_HEALTH = 150
export const REALISTIC_HEALTH = 65
export const BRUTALDEATHHEALTH = -400
export const HEADCHOPDEATHHEALTH = -90
export const HELMETFALLHEALTH = 70
export const HURT_HEALTH = 25

// time
export const PERMANENT = -1000
export const SECOND = 60
export const HALF_MINUTE = SECOND * 30
export const MINUTE = SECOND * 60
export const FIVE_MINUTES = MINUTE * 5
export const TWENTY_MINUTES = MINUTE * 20
export const HALF_HOUR = MINUTE * 30
export const SIXTY_MINUTES = MINUTE * 60
export const HOUR = SIXTY_MINUTES
export const DAY = HOUR * 24

// {$IFNDEF SERVER} — client-only, no server value exists.
export const MORECHATTEXT = 60
export const MAXCHATTEXT = 85
// display time for chars
export const SPACECHARDELAY = 68
export const CHARDELAY = 25

export const MAX_CHATDELAY = SECOND * 7 + 40

export const KILLCONSOLE_SEPARATE_HEIGHT = 8

// sound
export const DEFAULT_VOLUME_SETTING = 50

// animations
export const EXPLOSION_ANIMS = 16
export const SMOKE_ANIMS = 10

export const EXPLOSION_IMPACT_MULTIPLY = 3.75
export const EXPLOSION_DEADIMPACT_MULTIPLY = 4.5

export const BULLET_TIMEOUT = SECOND * 7
export const GRENADE_TIMEOUT = SECOND * 3
export const M2BULLET_TIMEOUT = SECOND
export const FLAMER_TIMEOUT = 32
export const MELEE_TIMEOUT = 1

export const M2HITMULTIPLY = 2
export const M2GUN_OVERAIM = 4
export const M2GUN_OVERHEAT = 18
export const GUNRESISTTIME = SECOND * 20

export const GUN_RADIUS = 10
export const BOW_RADIUS = 20
export const KIT_RADIUS = 12
export const STAT_RADIUS = 15

export const ARROW_RESIST = 280
export const ILUMINATESPEED = 0.085
export const MINMOVEDELTA = 0.63

export const POSDELTA = 60.0
export const VELDELTA = 0.27

export const MOUSEAIMDELTA = 30
export const SPAWNRANDOMVELOCITY = 25

export const FLAG_TIMEOUT = SECOND * 25
export const WAYPOINTTIMEOUT = SECOND * 5 + 20 // = 320
export const WAYPOINT_TIMEOUT = 480 // TODO: why the duplication? (preserved from Pascal source comment)

export const WAYPOINTSEEKRADIUS = 21

export const DEFAULT_INTEREST_TIME = SECOND * 5 + 50
export const FLAG_INTEREST_TIME = SECOND * 25
export const BOW_INTEREST_TIME = SECOND * 41 + 40

export const DEFAULT_MAPCHANGE_TIME = SECOND * 5 + 20

export const MEDIKITTHINGSDIV = 23
export const GRENADEKITTHINGSDIV = 23

export const CONNECTIONPROBLEM_TIME = SECOND * 4
export const CONNECTIONPROBLEM_TIME2 = SECOND * 5

export const DISCONNECTION_TIME = SECOND * 15

export const KILLMESSAGEWAIT = SECOND * 4
export const CAPTUREMESSAGEWAIT = SECOND * 6
export const GAMESTARTMESSAGEWAIT = SECOND * 5 + 20
export const CAPTURECTFMESSAGEWAIT = SECOND * 7

export const BLOOD_RANDOM_NORMAL = 10
export const BLOOD_RANDOM_LOW = 22
export const BLOOD_RANDOM_HIGH = 6

export const TORCH_RANDOM_NORMAL = 6
export const TORCH_RANDOM_LOW = 12

export const FIRE_RANDOM_HIGH = 30
export const FIRE_RANDOM_NORMAL = 50
export const FIRE_RANDOM_LOW = 70

export const CLIENTMAXPOSITIONDELTA = 169
export const DEFAULT_CEASEFIRE_TIME = 90
export const PREDATORALPHA = 5
export const DEFAULTVEST = 100

export const FLAMERBONUSTIME = 600
export const PREDATORBONUSTIME = 1500
export const BERSERKERBONUSTIME = 900

export const FLAMERBONUS_RANDOM = 5
export const PREDATORBONUS_RANDOM = 5
export const VESTBONUS_RANDOM = 4
export const BERSERKERBONUS_RANDOM = 4
export const CLUSTERBONUS_RANDOM = 4

export const BONUS_NONE = 0
export const BONUS_GRENADES = 17
export const BONUS_FLAMEGOD = 18
export const BONUS_PREDATOR = 19
export const BONUS_VEST = 20
export const BONUS_BERSERKER = 21
export const BONUS_CLUSTERS = 22

export const CURSORSPRITE_DISTANCE = 15
export const CLIENTSTOPMOVE_RETRYS = 90
export const MULTIKILLINTERVAL = 180

export const DEFAULT_IDLETIME = SECOND * 8
export const LONGER_IDLETIME = HALF_MINUTE

export const FRAGSMENU_PLAYER_HEIGHT = 15
export const GRENADEEFFECT_DIST = 38
export const HTF_SEC_POINT = 300

export const BACKGROUND_WIDTH = 64

export const MAX_ADMIN_FLOOD_IPS = 200
export const MAX_LAST_ADMIN_IPS = 5

export const WAVERESPAWN_TIME_MULITPLIER = 1

export const PARA_SPEED = -0.5 * 0.06 // GRAV
export const PARA_DISTANCE = 500

export const MAX_OLDPOS = 125
// {$IFDEF SERVER} MAX_PUSHTICK = 0 {$ELSE} MAX_PUSHTICK = 125 {$ENDIF} — client value below.
// TODO(M3) SERVER: MAX_PUSHTICK = 0
export const MAX_PUSHTICK = 125
export const MAX_INACCURACY = 0.5

export const THING_PUSH_MULTIPLIER = 9
export const THING_COLLISION_COOLDOWN = 60

export const FIREINTERVAL_NET = 5
export const MELEE_DIST = 12

// Pascal: `array[2..17] of WideString` — indices 0 and 1 are padded (Pascal array starts at 2,
// there is no kill-streak message for a single kill). Index N below matches Pascal index N.
export const MULTIKILLMESSAGE: readonly string[] = [
  '', // 0 — unused, padding (Pascal array starts at index 2)
  '', // 1 — unused, padding (Pascal array starts at index 2)
  'DOUBLE KILL', // 2
  'TRIPLE KILL', // 3
  'MULTI KILL', // 4
  'MULTI KILL X2', // 5
  'SERIAL KILL', // 6
  'INSANE KILLS', // 7
  'GIMME MORE!', // 8
  'MASTA KILLA!', // 9
  'MASTA KILLA!', // 10
  'MASTA KILLA!', // 11
  'STOP IT!!!!', // 12
  'MERCY!!!!!!!!!!', // 13
  'CHEATER!!!!!!!!', // 14
  'Phased-plasma rifle in the forty watt range', // 15
  'Hey, just what you see, pal', // 16
  'just what you see, pal...', // 17
]

export const DEFAULT_JETCOLOR = 0xffffbd24

export const IDLE_KICK = MINUTE * 3
export const MENU_TIME = SECOND
export const LESSBLEED_TIME = SECOND * 2
export const NOBLEED_TIME = SECOND * 5
export const ONFIRE_TIME = SECOND * 4

export const SURVIVAL_RESPAWNTIME = SECOND * 5
export const DEFAULT_VOTE_TIME = MINUTE * 2
export const DEFAULT_VOTING_TIME = SECOND * 20

// {$IFNDEF SERVER} — client-only, no server value exists.
export const WEP_RESTRICT_WIDTH = 64
export const WEP_RESTRICT_HEIGHT = 64
export const GOS_RESTRICT_WIDTH = 16
export const GOS_RESTRICT_HEIGHT = 16

export const TEXTSTYLE = 0
export const HORIZONTAL = 1
export const VERTICAL = 2

// Colors
export const DEFAULT_MESSAGE_COLOR = 0xeeccffaa
export const DEBUG_MESSAGE_COLOR = 0xeeff8989
export const GAME_MESSAGE_COLOR = 0xee71f981
export const WARNING_MESSAGE_COLOR = 0xeee36952

export const SERVER_MESSAGE_COLOR = 0xf9fbda22
export const CLIENT_MESSAGE_COLOR = 0xf9fcd822

export const ENTER_MESSAGE_COLOR = 0xf1c3c3c3

export const ABOVECHAT_MESSAGE_COLOR = 0xfdfdf9
export const CHAT_MESSAGE_COLOR = 0xeeeffeea
export const TEAMCHAT_MESSAGE_COLOR = 0xeefeda7c

export const KILL_MESSAGE_COLOR = 0xffea3530
export const SUICIDE_MESSAGE_COLOR = 0xd6b3a717
export const DIE_MESSAGE_COLOR = 0xffc53025

export const DEATH_MESSAGE_COLOR = 0xee801304
export const KILLER_MESSAGE_COLOR = 0xee52d119

export const GAMESTART_MESSAGE_COLOR = 0xffd3ca34

export const CAPTURE_MESSAGE_COLOR = 0xff77d334
export const RETURN_MESSAGE_COLOR = 0xff71a331

export const ALPHA_MESSAGE_COLOR = 0xffdf3131
export const BRAVO_MESSAGE_COLOR = 0xff3131df
export const CHARLIE_MESSAGE_COLOR = 0xffdfdf31
export const DELTA_MESSAGE_COLOR = 0xff31df31

export const ALPHAJ_MESSAGE_COLOR = 0xffe15353
export const BRAVOJ_MESSAGE_COLOR = 0xff5353e1
export const CHARLIEJ_MESSAGE_COLOR = 0xffdfdf53
export const DELTAJ_MESSAGE_COLOR = 0xff53df53

export const BONUS_MESSAGE_COLOR = 0xffef3121
export const VOTE_MESSAGE_COLOR = 0xeeddee99
export const MUSIC_MESSAGE_COLOR = 0xeeadfe99
export const INFO_MESSAGE_COLOR = 0xeedddea2
export const REGINFO_MESSAGE_COLOR = 0xeea2dedd
export const MODE_MESSAGE_COLOR = 0xee81da41

export const OUTOFSCREEN_MESSAGE_COLOR = 0x99df99
export const OUTOFSCREENDEAD_MESSAGE_COLOR = 0x983333
export const OUTOFSCREENFLAG_MESSAGE_COLOR = 0xdcdc33

export const AC_MESSAGE_COLOR = 0xeee739b1

export const ALPHA_K_MESSAGE_COLOR = 0xebffe3e3
export const BRAVO_K_MESSAGE_COLOR = 0xebd3e3ff
export const CHARLIE_K_MESSAGE_COLOR = 0xebffffe3
export const DELTA_K_MESSAGE_COLOR = 0xebd3ffe3

export const ALPHA_D_MESSAGE_COLOR = 0xebdab0b0
export const BRAVO_D_MESSAGE_COLOR = 0xeba0b0da
export const CHARLIE_D_MESSAGE_COLOR = 0xebd0d0b0
export const DELTA_D_MESSAGE_COLOR = 0xeba0d0ba
export const SPECTATOR_D_MESSAGE_COLOR = 0xebd3b727

export const ALPHA_C_MESSAGE_COLOR = 0xf5fee8e8
export const BRAVO_C_MESSAGE_COLOR = 0xf5e3e8fe
export const CHARLIE_C_MESSAGE_COLOR = 0xf5fefee8
export const DELTA_C_MESSAGE_COLOR = 0xf5e8fee8
export const SPECTATOR_C_MESSAGE_COLOR = 0xf5df7ab0

// 0 represents in some cases all players
export const ALL_PLAYERS = 0

// Player teams
export const TEAM_NONE = 0
export const TEAM_ALPHA = 1
export const TEAM_BRAVO = 2
export const TEAM_CHARLIE = 3
export const TEAM_DELTA = 4
export const TEAM_SPECTATOR = 5

// Game styles
export const GAMESTYLE_DEATHMATCH = 0
export const GAMESTYLE_POINTMATCH = 1
export const GAMESTYLE_TEAMMATCH = 2
export const GAMESTYLE_CTF = 3
export const GAMESTYLE_RAMBO = 4
export const GAMESTYLE_INF = 5
export const GAMESTYLE_HTF = 6

// Vote types
export const VOTE_MAP = 0
export const VOTE_KICK = 1

export const COLOR_TRANSPARENCY_UNREGISTERED = 0xff000000
export const COLOR_TRANSPARENCY_REGISTERED = 0xfe000000
export const COLOR_TRANSPARENCY_SPECIAL = 0xfd000000
export const COLOR_TRANSPARENCY_BOT = 0xfb000000

// Polygon types
export const PT_ONLYBULLETS = 1
export const PT_ONLYPLAYERS = 2
export const PT_DOESNTCOLLIDE = 3
export const PT_ICE = 4
export const PT_DEADLY = 5
export const PT_BLOODYDEADLY = 6
export const PT_HURTS = 7
export const PT_REGENERATES = 8
export const PT_LAVA = 9
export const PT_ALPHABULLETS = 10
export const PT_ALPHAPLAYERS = 11
export const PT_BRAVOBULLETS = 12
export const PT_BRAVOPLAYERS = 13
export const PT_CHARLIEBULLETS = 14
export const PT_CHARLIEPLAYERS = 15
export const PT_DELTABULLETS = 16
export const PT_DELTAPLAYERS = 17
export const PT_BOUNCY = 18
export const PT_EXPLOSIVE = 19
export const PT_HURTFLAGGERS = 20
export const PT_FLAGGERCOLLIDES = 21
export const PT_NONFLAGGERCOLLIDES = 22
export const PT_FLAGCOLLIDES = 23

// Game objects
export const OBJECT_NUM_NONWEAPON = 12
export const OBJECT_NUM_FLAGS = 3

export const OBJECT_ALPHA_FLAG = 1
export const OBJECT_BRAVO_FLAG = 2
export const OBJECT_POINTMATCH_FLAG = 3
export const OBJECT_USSOCOM = 4
export const OBJECT_DESERT_EAGLE = 5
export const OBJECT_HK_MP5 = 6
export const OBJECT_AK74 = 7
export const OBJECT_STEYR_AUG = 8
export const OBJECT_SPAS12 = 9
export const OBJECT_RUGER77 = 10
export const OBJECT_M79 = 11
export const OBJECT_BARRET_M82A1 = 12
export const OBJECT_MINIMI = 13
export const OBJECT_MINIGUN = 14
export const OBJECT_RAMBO_BOW = 15
export const OBJECT_MEDICAL_KIT = 16
export const OBJECT_GRENADE_KIT = 17
export const OBJECT_FLAMER_KIT = 18
export const OBJECT_PREDATOR_KIT = 19
export const OBJECT_VEST_KIT = 20
export const OBJECT_BERSERK_KIT = 21
export const OBJECT_CLUSTER_KIT = 22
export const OBJECT_PARACHUTE = 23
export const OBJECT_COMBAT_KNIFE = 24
export const OBJECT_CHAINSAW = 25
export const OBJECT_LAW = 26
export const OBJECT_STATIONARY_GUN = 27

// Sound effects
export const SFX_AK74_FIRE = 1
export const SFX_ROCKETZ = 2
export const SFX_AK74_RELOAD = 3
export const SFX_M249_FIRE = 5
export const SFX_RUGER77_FIRE = 6
export const SFX_RUGER77_RELOAD = 7
export const SFX_M249_RELOAD = 8
export const SFX_MP5_FIRE = 9
export const SFX_MP5_RELOAD = 10
export const SFX_SPAS12_FIRE = 11
export const SFX_SPAS12_RELOAD = 12
export const SFX_STANDUP = 13
export const SFX_FALL = 14
export const SFX_SPAWN = 15
export const SFX_M79_FIRE = 16
export const SFX_M79_EXPLOSION = 17
export const SFX_M79_RELOAD = 18
export const SFX_GRENADE_THROW = 19
export const SFX_GRENADE_EXPLOSION = 20
export const SFX_GRENADE_BOUNCE = 21
export const SFX_BRYZG = 22
export const SFX_INFILTMUS = 23
export const SFX_HEADCHOP = 24
export const SFX_EXPLOSION_ERG = 25
export const SFX_WATER_STEP = 26
export const SFX_BULLETBY = 27
export const SFX_BODYFALL = 28
export const SFX_DESERTEAGLE_FIRE = 29
export const SFX_DESERTEAGLE_RELOAD = 30
export const SFX_STEYRAUG_FIRE = 31
export const SFX_STEYRAUG_RELOAD = 32
export const SFX_BARRETM82_FIRE = 33
export const SFX_BARRETM82_RELOAD = 34
export const SFX_MINIGUN_FIRE = 35
export const SFX_MINIGUN_RELOAD = 36
export const SFX_MINIGUN_START = 37
export const SFX_MINIGUN_END = 38
export const SFX_PICKUPGUN = 39
export const SFX_CAPTURE = 40
export const SFX_COLT1911_FIRE = 41
export const SFX_COLT1911_RELOAD = 42
export const SFX_CHANGEWEAPON = 43
export const SFX_SHELL = 44
export const SFX_SHELL2 = 45
export const SFX_DEAD_HIT = 46
export const SFX_THROWGUN = 47
export const SFX_BOW_FIRE = 48
export const SFX_TAKEBOW = 49
export const SFX_TAKEMEDIKIT = 50
export const SFX_WERMUSIC = 51
export const SFX_TS = 52
export const SFX_CTF = 53
export const SFX_BERSERKER = 54
export const SFX_GODFLAME = 55
export const SFX_FLAMER = 56
export const SFX_PREDATOR = 57
export const SFX_KILLBERSERK = 58
export const SFX_VESTHIT = 59
export const SFX_BURN = 60
export const SFX_VESTTAKE = 61
export const SFX_CLUSTERGRENADE = 62
export const SFX_CLUSTER_EXPLOSION = 63
export const SFX_GRENADE_PULLOUT = 64
export const SFX_SPIT = 65
export const SFX_STUFF = 66
export const SFX_SMOKE = 67
export const SFX_MATCH = 68
export const SFX_ROAR = 69
export const SFX_STEP = 70
export const SFX_STEP2 = 71
export const SFX_STEP3 = 72
export const SFX_STEP4 = 73
export const SFX_HUM = 74
export const SFX_RIC = 75
export const SFX_RIC2 = 76
export const SFX_RIC3 = 77
export const SFX_RIC4 = 78
export const SFX_DIST_M79 = 79
export const SFX_DIST_GRENADE = 80
export const SFX_DIST_GUN1 = 81
export const SFX_DIST_GUN2 = 82
export const SFX_DIST_GUN3 = 83
export const SFX_DIST_GUN4 = 84
export const SFX_DEATH = 85
export const SFX_DEATH2 = 86
export const SFX_DEATH3 = 87
export const SFX_CROUCH_MOVE = 88
export const SFX_HIT_ARG = 89
export const SFX_HIT_ARG2 = 90
export const SFX_HIT_ARG3 = 91
export const SFX_GOPRONE = 92
export const SFX_ROLL = 93
export const SFX_FALL_HARD = 94
export const SFX_ONFIRE = 95
export const SFX_FIRECRACK = 96
export const SFX_SCOPE = 97
export const SFX_SCOPEBACK = 98
export const SFX_PLAYERDEATH = 99
export const SFX_CHANGESPIN = 100
export const SFX_ARG = 101
export const SFX_LAVA = 102
export const SFX_REGENERATE = 103
export const SFX_PRONE_MOVE = 104
export const SFX_JUMP = 105
export const SFX_CROUCH = 106
export const SFX_CROUCH_MOVEL = 107
export const SFX_STEP5 = 108
export const SFX_STEP6 = 109
export const SFX_STEP7 = 110
export const SFX_STEP8 = 111
export const SFX_STOP = 112
export const SFX_BULLETBY2 = 113
export const SFX_BULLETBY3 = 114
export const SFX_BULLETBY4 = 115
export const SFX_BULLETBY5 = 116
export const SFX_WEAPONHIT = 117
export const SFX_CLIPFALL = 118
export const SFX_BONECRACK = 119
export const SFX_GAUGESHELL = 120
export const SFX_COLLIDERHIT = 121
export const SFX_KIT_FALL = 122
export const SFX_KIT_FALL2 = 123
export const SFX_FLAG = 124
export const SFX_FLAG2 = 125
export const SFX_TAKEGUN = 126
export const SFX_INFILT_POINT = 127
export const SFX_MENUCLICK = 128
export const SFX_KNIFE = 129
export const SFX_SLASH = 130
export const SFX_CHAINSAW_D = 131
export const SFX_CHAINSAW_M = 132
export const SFX_CHAINSAW_R = 133
export const SFX_PISS = 134
export const SFX_LAW = 135
export const SFX_CHAINSAW_O = 136
export const SFX_M2FIRE = 137
export const SFX_M2EXPLODE = 138
export const SFX_M2OVERHEAT = 139
export const SFX_SIGNAL = 140
export const SFX_M2USE = 141
export const SFX_SCOPERUN = 142
export const SFX_MERCY = 143
export const SFX_RIC5 = 144
export const SFX_RIC6 = 145
export const SFX_RIC7 = 146
export const SFX_LAW_START = 147
export const SFX_LAW_END = 148
export const SFX_BOOMHEADSHOT = 149
export const SFX_SNAPSHOT = 150
export const SFX_RADIO_EFCUP = 151
export const SFX_RADIO_EFCMID = 152
export const SFX_RADIO_EFCDOWN = 153
export const SFX_RADIO_FFCUP = 154
export const SFX_RADIO_FFCMID = 155
export const SFX_RADIO_FFCDOWN = 156
export const SFX_RADIO_ESUP = 157
export const SFX_RADIO_ESMID = 158
export const SFX_RADIO_ESDOWN = 159
export const SFX_BOUNCE = 160
export const SFX_RAIN = 161
export const SFX_SNOW = 162
export const SFX_WIND = 163
