import Phaser from 'phaser';

const WIDTH = 480;
const HEIGHT = 640;

const PLAYER_SPEED = 320;
const PLAYER_FIRE_COOLDOWN = 280;
const PLAYER_BULLET_SPEED = 520;
const ENEMY_BULLET_SPEED = 260;

const FORMATION_ROWS = 4;
const FORMATION_COLS = 7;
const FORMATION_TOP = 90;
const FORMATION_LEFT = 60;
const FORMATION_SPACING_X = 52;
const FORMATION_SPACING_Y = 46;

const DIVE_MIN_DELAY = 900;
const DIVE_MAX_DELAY = 2200;
const DIVE_DURATION = 2600;

const ENEMY_TYPES = {
  boss: { color: 0xf5c518, accent: 0xfff3b0, score: 150, w: 36, h: 34 },
  blue: { color: 0x4aa3ff, accent: 0xdcf1ff, score: 50, w: 28, h: 26 },
  red: { color: 0xe74c3c, accent: 0xffd9d2, score: 60, w: 28, h: 26 },
};

const POWERUP_TYPES = {
  rapid: { key: 'pu_rapid', color: 0xffe066, label: 'RAPID FIRE' },
  spread: { key: 'pu_spread', color: 0x66ff99, label: 'SPREAD SHOT' },
  shield: { key: 'pu_shield', color: 0x66ccff, label: 'SHIELD' },
};
const POWERUP_DROP_CHANCE = 0.18;
const POWERUP_FALL_SPEED = 90;
const RAPID_DURATION = 8000;
const SPREAD_DURATION = 8000;
const SHIELD_DURATION = 6000;
const RAPID_COOLDOWN_MULTIPLIER = 0.4;
const SPREAD_ANGLES_DEG = [-14, 0, 14];

const CAPTURE_ATTEMPT_CHANCE = 0.35;
const CAPTURE_HOVER_Y_RATIO = 0.34;
const CAPTURE_PHASE = { descendEnd: 0.32, telegraphEnd: 0.5, activeEnd: 0.78 };
const CAPTURE_BEAM_COLOR = 0x9b59d0;
const CAPTURE_BEAM_HALF_WIDTH = 22;
const RESCUE_FALL_SPEED = 70;

function rowType(row) {
  if (row === 0) return 'boss';
  return row % 2 === 0 ? 'blue' : 'red';
}

function darken(color, amount) {
  const c = Phaser.Display.Color.ValueToColor(color);
  return Phaser.Display.Color.GetColor(
    Math.round(c.red * (1 - amount)),
    Math.round(c.green * (1 - amount)),
    Math.round(c.blue * (1 - amount))
  );
}

// Draws an insectoid ship silhouette (swept wings + body + glowing eye) into
// the given Graphics object, sized to fill a w x h texture canvas.
function drawEnemyShip(g, cfg, isBoss) {
  const w = cfg.w;
  const h = cfg.h;
  const cx = w / 2;

  g.fillStyle(darken(cfg.color, 0.35), 1);
  g.beginPath();
  g.moveTo(cx, h * 0.35);
  g.lineTo(0, h * 0.1);
  g.lineTo(w * 0.16, h);
  g.lineTo(cx, h * 0.62);
  g.closePath();
  g.fillPath();
  g.beginPath();
  g.moveTo(cx, h * 0.35);
  g.lineTo(w, h * 0.1);
  g.lineTo(w * 0.84, h);
  g.lineTo(cx, h * 0.62);
  g.closePath();
  g.fillPath();

  g.fillStyle(cfg.color, 1);
  g.beginPath();
  g.moveTo(cx, 0);
  g.lineTo(w * 0.74, h * 0.5);
  g.lineTo(cx, h * 0.9);
  g.lineTo(w * 0.26, h * 0.5);
  g.closePath();
  g.fillPath();

  if (isBoss) {
    g.fillStyle(cfg.color, 1);
    g.fillTriangle(cx - w * 0.3, h * 0.16, cx - w * 0.12, 0, cx - w * 0.02, h * 0.18);
    g.fillTriangle(cx + w * 0.3, h * 0.16, cx + w * 0.12, 0, cx + w * 0.02, h * 0.18);
  }

  g.fillStyle(cfg.accent, 1);
  g.fillCircle(cx, h * 0.4, w * 0.15);
}

// Cubic bezier through 4 control points, used for the dive-and-loop path.
function samplePath(points, t) {
  const [p0, p1, p2, p3] = points;
  const u = 1 - t;
  const x = u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x;
  const y = u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y;
  return { x, y };
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init() {
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.fireTimer = 0;
    this.diveTimer = Phaser.Math.Between(DIVE_MIN_DELAY, DIVE_MAX_DELAY);
    this.enemies = [];
    this.gameOver = false;
    this.invulnUntil = 0;
    this.rapidUntil = 0;
    this.spreadUntil = 0;
    this.shieldUntil = 0;
    this.playerCaptured = false;
  }

  preload() {
    this.generateTextures();
  }

  create() {
    this.physics.world.setBounds(0, 0, WIDTH, HEIGHT);
    this.stars = this.add.tileSprite(0, 0, WIDTH, HEIGHT, 'stars').setOrigin(0, 0);

    this.player = this.physics.add.sprite(WIDTH / 2, HEIGHT - 60, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(14, 32).setOffset(13, 2);

    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.enemyGroup = this.physics.add.group();
    this.powerups = this.physics.add.group();
    this.rescueGroup = this.physics.add.group();

    this.shieldRing = this.add
      .circle(0, 0, 26, 0x66ccff, 0.2)
      .setStrokeStyle(2, 0x66ccff, 0.9)
      .setVisible(false)
      .setDepth(5);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('A,D');
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Touch/mouse control: drag anywhere to follow the pointer's x, firing
    // automatically while held down. Keeps the game playable with one thumb
    // and no on-screen buttons eating into the play field.
    this.pointerActive = false;
    this.pointerTargetX = this.player.x;
    this.input.on('pointerdown', (pointer) => {
      if (this.gameOver) return;
      this.pointerActive = true;
      this.pointerTargetX = pointer.x;
    });
    this.input.on('pointermove', (pointer) => {
      if (this.pointerActive) this.pointerTargetX = pointer.x;
    });
    this.input.on('pointerup', () => {
      this.pointerActive = false;
    });

    this.scoreText = this.add.text(10, 8, 'SCORE 0', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' });
    this.livesText = this.add
      .text(WIDTH - 10, 8, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' })
      .setOrigin(1, 0);
    this.waveText = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 60, '', { fontFamily: 'monospace', fontSize: '28px', color: '#f5c518' })
      .setOrigin(0.5);
    this.buffText = this.add
      .text(WIDTH - 10, 32, '', { fontFamily: 'monospace', fontSize: '12px', color: '#9be8ff' })
      .setOrigin(1, 0);

    const touchHint = this.add
      .text(WIDTH / 2, HEIGHT - 14, '터치 후 드래그로 이동 · 누르고 있으면 자동 발사', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#8899aa',
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: touchHint, alpha: 0, delay: 3500, duration: 800, onComplete: () => touchHint.destroy() });

    this.physics.add.overlap(this.playerBullets, this.enemyGroup, (bullet, enemySprite) =>
      this.onBulletHitEnemy(bullet, enemySprite)
    );
    this.physics.add.overlap(this.player, this.enemyBullets, (player, bullet) => this.onPlayerHitByBullet(bullet));
    this.physics.add.overlap(this.player, this.enemyGroup, (player, enemySprite) => this.onPlayerCollideEnemy(enemySprite));
    this.physics.add.overlap(this.player, this.powerups, (player, powerup) => this.onCollectPowerup(powerup));
    this.physics.add.overlap(this.player, this.rescueGroup, (player, rescue) => this.onRescueCollect(rescue));

    this.updateLivesText();
    this.startWave();
  }

  generateTextures() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });

    // starfield background
    g.fillStyle(0x05060a, 1);
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle(0xffffff, 1);
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * WIDTH;
      const y = Math.random() * HEIGHT;
      const s = Math.random() < 0.8 ? 1 : 2;
      g.fillRect(x, y, s, s);
    }
    g.generateTexture('stars', WIDTH, HEIGHT);
    g.clear();

    // player fighter jet (nose up)
    g.fillStyle(0xff8a3d, 1);
    g.fillTriangle(20, 44, 14, 33, 26, 33);
    g.fillStyle(0x2f6fb0, 1);
    g.beginPath();
    g.moveTo(20, 13);
    g.lineTo(2, 33);
    g.lineTo(11, 33);
    g.lineTo(20, 21);
    g.closePath();
    g.fillPath();
    g.beginPath();
    g.moveTo(20, 13);
    g.lineTo(38, 33);
    g.lineTo(29, 33);
    g.lineTo(20, 21);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x53d0ff, 1);
    g.beginPath();
    g.moveTo(20, 0);
    g.lineTo(26, 18);
    g.lineTo(24, 35);
    g.lineTo(16, 35);
    g.lineTo(14, 18);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x0d2b3d, 1);
    g.fillEllipse(20, 12, 6, 10);
    g.fillStyle(0xff5555, 1);
    g.fillCircle(4, 32, 2);
    g.fillStyle(0x55ff77, 1);
    g.fillCircle(36, 32, 2);
    g.generateTexture('player', 40, 44);
    g.clear();

    // player bullet
    g.fillStyle(0x9be8ff, 1);
    g.fillRect(0, 0, 4, 14);
    g.generateTexture('playerBullet', 4, 14);
    g.clear();

    // enemy bullet
    g.fillStyle(0xff5555, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('enemyBullet', 8, 8);
    g.clear();

    // rapid fire powerup (speed chevrons)
    g.fillStyle(POWERUP_TYPES.rapid.color, 1);
    g.fillCircle(12, 12, 12);
    g.fillStyle(0x2c2c2c, 1);
    g.fillTriangle(6, 6, 6, 18, 13, 12);
    g.fillTriangle(13, 6, 13, 18, 20, 12);
    g.generateTexture('pu_rapid', 24, 24);
    g.clear();

    // spread shot powerup (three-way fan)
    g.fillStyle(POWERUP_TYPES.spread.color, 1);
    g.fillCircle(12, 12, 12);
    g.fillStyle(0x0d3320, 1);
    g.fillCircle(7, 16, 2.2);
    g.fillCircle(12, 6, 2.2);
    g.fillCircle(17, 16, 2.2);
    g.generateTexture('pu_spread', 24, 24);
    g.clear();

    // shield powerup (ring)
    g.fillStyle(POWERUP_TYPES.shield.color, 1);
    g.fillCircle(12, 12, 12);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(12, 12, 8);
    g.fillStyle(POWERUP_TYPES.shield.color, 1);
    g.fillCircle(12, 12, 5);
    g.generateTexture('pu_shield', 24, 24);
    g.clear();

    for (const [key, cfg] of Object.entries(ENEMY_TYPES)) {
      g.clear();
      drawEnemyShip(g, cfg, key === 'boss');
      g.generateTexture(`enemy_${key}`, cfg.w, cfg.h);
    }

    g.destroy();
  }

  startWave() {
    this.enemies.forEach((enemy) => {
      enemy.sprite.destroy();
      enemy.captiveSprite?.destroy();
      enemy.beamGraphic?.destroy();
    });
    this.enemies = [];

    for (let row = 0; row < FORMATION_ROWS; row++) {
      for (let col = 0; col < FORMATION_COLS; col++) {
        const type = rowType(row);
        const baseX = FORMATION_LEFT + col * FORMATION_SPACING_X;
        const baseY = FORMATION_TOP + row * FORMATION_SPACING_Y;
        const sprite = this.physics.add.sprite(baseX, -40 - row * 20, `enemy_${type}`);
        this.enemyGroup.add(sprite);

        const enemy = { sprite, type, baseX, baseY, state: 'entering' };
        this.enemies.push(enemy);

        this.tweens.add({
          targets: sprite,
          x: baseX,
          y: baseY,
          duration: 700 + Math.random() * 500,
          delay: (row * FORMATION_COLS + col) * 40,
          ease: 'Sine.easeOut',
          onComplete: () => {
            if (enemy.state === 'entering') enemy.state = 'formation';
          },
        });
      }
    }

    this.waveText.setText(`WAVE ${this.wave}`).setAlpha(1);
    this.tweens.add({ targets: this.waveText, alpha: 0, delay: 900, duration: 500 });
  }

  update(time, delta) {
    if (this.gameOver) return;

    this.stars.tilePositionY -= delta * 0.05;

    this.handleInput(delta, time);
    this.updateFormationSway(time);
    this.updateDiving(time, delta);
    this.cleanupBullets();
    this.updatePowerupEffects(time);
    this.cleanupRescues();

    if (this.enemies.every((enemy) => enemy.state === 'dead')) {
      this.wave += 1;
      this.startWave();
    }
  }

  handleInput(delta, time) {
    if (this.playerCaptured) {
      this.player.setVelocity(0, 0);
      return;
    }

    if (this.pointerActive) {
      this.player.x = Phaser.Math.Clamp(this.pointerTargetX, 24, WIDTH - 24);
      this.player.setVelocityX(0);
    } else {
      let vx = 0;
      if (this.cursors.left.isDown || this.wasd.A.isDown) vx -= 1;
      if (this.cursors.right.isDown || this.wasd.D.isDown) vx += 1;
      this.player.setVelocityX(vx * PLAYER_SPEED);
    }

    this.fireTimer -= delta;
    if ((this.spaceKey.isDown || this.pointerActive) && this.fireTimer <= 0) {
      const rapidActive = time < this.rapidUntil;
      this.fireTimer = rapidActive ? PLAYER_FIRE_COOLDOWN * RAPID_COOLDOWN_MULTIPLIER : PLAYER_FIRE_COOLDOWN;
      this.fireBullets(time);
    }
  }

  fireBullets(time) {
    const spreadActive = time < this.spreadUntil;
    const angles = spreadActive ? SPREAD_ANGLES_DEG : [0];

    for (const angleDeg of angles) {
      const bullet = this.physics.add.sprite(this.player.x, this.player.y - 20, 'playerBullet');
      this.playerBullets.add(bullet);
      const rad = Phaser.Math.DegToRad(angleDeg - 90);
      this.physics.velocityFromRotation(rad, PLAYER_BULLET_SPEED, bullet.body.velocity);
    }
  }

  updateFormationSway(time) {
    const offset = Math.sin(time / 900) * 24;
    for (const enemy of this.enemies) {
      if (enemy.state === 'formation') {
        enemy.sprite.x = enemy.baseX + offset;
        enemy.sprite.y = enemy.baseY;
        this.syncCaptive(enemy);
      }
    }
  }

  updateDiving(time, delta) {
    this.diveTimer -= delta;
    if (this.diveTimer <= 0) {
      this.tryStartDive();
      this.diveTimer = Phaser.Math.Between(DIVE_MIN_DELAY, DIVE_MAX_DELAY) / Math.sqrt(this.wave);
    }

    for (const enemy of this.enemies) {
      if (enemy.state !== 'diving') continue;

      enemy.diveT += delta / DIVE_DURATION;
      if (enemy.diveT >= 1) {
        enemy.state = 'formation';
        enemy.sprite.x = enemy.baseX;
        enemy.sprite.y = enemy.baseY;
        if (enemy.beamGraphic) {
          enemy.beamGraphic.destroy();
          enemy.beamGraphic = null;
        }
        this.syncCaptive(enemy);
        continue;
      }

      if (enemy.diveMode === 'capture') {
        this.updateCaptureDive(enemy, time);
      } else {
        const pos = samplePath(enemy.divePath, enemy.diveT);
        enemy.sprite.x = pos.x;
        enemy.sprite.y = pos.y;

        if (!enemy.hasFired && enemy.diveT > 0.45) {
          enemy.hasFired = true;
          this.enemyFire(enemy.sprite.x, enemy.sprite.y);
        }
      }
      this.syncCaptive(enemy);
    }
  }

  tryStartDive() {
    const candidates = this.enemies.filter((enemy) => enemy.state === 'formation');
    if (candidates.length === 0) return;

    const enemy = Phaser.Utils.Array.GetRandom(candidates);
    enemy.state = 'diving';
    enemy.diveT = 0;
    enemy.hasFired = false;

    const canCapture = enemy.type === 'boss' && !enemy.hasCaptive;
    enemy.diveMode = canCapture && Math.random() < CAPTURE_ATTEMPT_CHANCE ? 'capture' : 'attack';

    if (enemy.diveMode === 'capture') {
      enemy.captureHoverX = Phaser.Math.Clamp(this.player.x, 40, WIDTH - 40);
      enemy.captureHoverY = HEIGHT * CAPTURE_HOVER_Y_RATIO;
      enemy.captureTriggered = false;
      enemy.beamGraphic = this.add
        .rectangle(enemy.captureHoverX, enemy.captureHoverY, 6, 0, CAPTURE_BEAM_COLOR, 0.5)
        .setOrigin(0.5, 0)
        .setDepth(4);
      return;
    }

    const startX = enemy.baseX;
    const startY = enemy.baseY;
    const targetX = Phaser.Math.Clamp(this.player.x + Phaser.Math.Between(-40, 40), 30, WIDTH - 30);

    enemy.divePath = [
      { x: startX, y: startY },
      { x: startX + (targetX - startX) * 0.3, y: HEIGHT * 0.45 },
      { x: targetX, y: HEIGHT - 90 },
      { x: startX, y: startY },
    ];
  }

  updateCaptureDive(enemy, time) {
    const t = enemy.diveT;
    const { descendEnd, telegraphEnd, activeEnd } = CAPTURE_PHASE;

    if (t <= descendEnd) {
      const localT = Phaser.Math.Easing.Sine.Out(t / descendEnd);
      enemy.sprite.x = Phaser.Math.Linear(enemy.baseX, enemy.captureHoverX, localT);
      enemy.sprite.y = Phaser.Math.Linear(enemy.baseY, enemy.captureHoverY, localT);
      return;
    }

    if (t <= activeEnd) {
      enemy.sprite.x = enemy.captureHoverX;
      enemy.sprite.y = enemy.captureHoverY;

      const beam = enemy.beamGraphic;
      const beamTop = enemy.sprite.y + 14;
      if (t <= telegraphEnd) {
        const pulse = 0.3 + 0.3 * Math.abs(Math.sin(time / 80));
        beam.setPosition(enemy.sprite.x, beamTop);
        beam.width = 6;
        beam.height = HEIGHT - beamTop;
        beam.setFillStyle(CAPTURE_BEAM_COLOR, pulse);
      } else {
        beam.setPosition(enemy.sprite.x, beamTop);
        beam.width = CAPTURE_BEAM_HALF_WIDTH * 2;
        beam.height = HEIGHT - beamTop;
        beam.setFillStyle(CAPTURE_BEAM_COLOR, 0.55);

        if (!enemy.captureTriggered && !this.playerCaptured && !this.gameOver) {
          const withinBeam = Math.abs(this.player.x - enemy.captureHoverX) < CAPTURE_BEAM_HALF_WIDTH;
          const playerSafe = time < this.invulnUntil || time < this.shieldUntil;
          if (withinBeam && !playerSafe) {
            enemy.captureTriggered = true;
            this.capturePlayer(enemy);
          }
        }
      }
      return;
    }

    const localT = Phaser.Math.Easing.Sine.In((t - activeEnd) / (1 - activeEnd));
    enemy.sprite.x = Phaser.Math.Linear(enemy.captureHoverX, enemy.baseX, localT);
    enemy.sprite.y = Phaser.Math.Linear(enemy.captureHoverY, enemy.baseY, localT);
    if (enemy.beamGraphic) {
      enemy.beamGraphic.destroy();
      enemy.beamGraphic = null;
    }
  }

  syncCaptive(enemy) {
    if (enemy.captiveSprite) {
      enemy.captiveSprite.setPosition(enemy.sprite.x, enemy.sprite.y + 20);
    }
  }

  enemyFire(x, y) {
    const bullet = this.physics.add.sprite(x, y, 'enemyBullet');
    this.enemyBullets.add(bullet);
    const angle = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
    this.physics.velocityFromRotation(angle, ENEMY_BULLET_SPEED, bullet.body.velocity);
  }

  cleanupBullets() {
    this.playerBullets.children.each((bullet) => {
      if (bullet.y < -20) bullet.destroy();
    });
    this.enemyBullets.children.each((bullet) => {
      if (bullet.y > HEIGHT + 20 || bullet.y < -20 || bullet.x < -20 || bullet.x > WIDTH + 20) bullet.destroy();
    });
  }

  killEnemy(enemy, wasDiving) {
    if (enemy.state === 'dead') return;
    enemy.state = 'dead';

    const base = ENEMY_TYPES[enemy.type].score;
    this.score += wasDiving ? base * 2 : base;
    this.scoreText.setText(`SCORE ${this.score}`);

    const { x, y } = enemy.sprite;
    this.explode(x, y, ENEMY_TYPES[enemy.type].color);
    enemy.sprite.destroy();

    if (enemy.beamGraphic) {
      enemy.beamGraphic.destroy();
      enemy.beamGraphic = null;
    }

    if (enemy.hasCaptive) {
      this.releaseCaptive(enemy);
    } else if (Math.random() < POWERUP_DROP_CHANCE) {
      this.spawnPowerup(x, y);
    }
  }

  capturePlayer(enemy) {
    if (this.playerCaptured) return;
    this.playerCaptured = true;
    // Disable the body immediately (not just on tween-complete) so the
    // pull-in animation can't also trigger a normal bullet/collision hit.
    this.player.body.enable = false;

    this.tweens.add({
      targets: this.player,
      x: enemy.sprite.x,
      y: enemy.sprite.y + 20,
      duration: 400,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.player.setVisible(false);

        enemy.hasCaptive = true;
        enemy.captiveSprite = this.add
          .sprite(enemy.sprite.x, enemy.sprite.y + 20, 'player')
          .setScale(0.7)
          .setTint(0x777777)
          .setDepth(3);

        this.lives -= 1;
        this.updateLivesText();
        this.showPickupText('CAPTURED!', CAPTURE_BEAM_COLOR);

        if (this.lives <= 0) {
          this.endGame();
          return;
        }
        this.time.delayedCall(700, () => this.respawnAfterCapture());
      },
    });
  }

  respawnAfterCapture() {
    this.playerCaptured = false;
    this.player.setPosition(WIDTH / 2, HEIGHT - 60);
    this.player.setVisible(true);
    this.player.body.enable = true;
    this.player.setAlpha(0.4);
    this.invulnUntil = this.time.now + 1500;
    this.tweens.add({ targets: this.player, alpha: 1, duration: 1200 });
  }

  releaseCaptive(enemy) {
    const sprite = enemy.captiveSprite;
    enemy.captiveSprite = null;
    enemy.hasCaptive = false;
    if (!sprite) return;

    sprite.clearTint();
    this.physics.add.existing(sprite);
    this.rescueGroup.add(sprite);
    // A plain sprite promoted via physics.add.existing() only gets a `.body`,
    // not the Arcade.Sprite convenience methods - set velocity on the body itself.
    sprite.body.setVelocity(0, RESCUE_FALL_SPEED);
    this.tweens.add({ targets: sprite, alpha: 0.5, duration: 300, yoyo: true, repeat: -1 });
  }

  onRescueCollect(sprite) {
    sprite.destroy();
    this.lives += 1;
    this.updateLivesText();
    this.showPickupText('RESCUED! +1 LIFE', CAPTURE_BEAM_COLOR);
  }

  cleanupRescues() {
    this.rescueGroup.children.each((sprite) => {
      if (sprite.y > HEIGHT + 20) sprite.destroy();
    });
  }

  spawnPowerup(x, y) {
    const type = Phaser.Utils.Array.GetRandom(Object.keys(POWERUP_TYPES));
    const sprite = this.physics.add.sprite(x, y, POWERUP_TYPES[type].key);
    this.powerups.add(sprite);
    sprite.setVelocityY(POWERUP_FALL_SPEED);
    sprite.setData('type', type);
  }

  onCollectPowerup(powerupSprite) {
    const type = powerupSprite.getData('type');
    powerupSprite.destroy();

    const now = this.time.now;
    if (type === 'rapid') this.rapidUntil = now + RAPID_DURATION;
    else if (type === 'spread') this.spreadUntil = now + SPREAD_DURATION;
    else if (type === 'shield') this.shieldUntil = now + SHIELD_DURATION;

    this.showPickupText(POWERUP_TYPES[type].label, POWERUP_TYPES[type].color);
  }

  showPickupText(label, color) {
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const text = this.add
      .text(this.player.x, this.player.y - 30, label, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: hex,
      })
      .setOrigin(0.5);

    this.tweens.add({ targets: text, y: text.y - 30, alpha: 0, duration: 900, onComplete: () => text.destroy() });
  }

  updatePowerupEffects(time) {
    const shieldOn = time < this.shieldUntil;
    this.shieldRing.setVisible(shieldOn);
    if (shieldOn) this.shieldRing.setPosition(this.player.x, this.player.y);

    this.powerups.children.each((powerup) => {
      if (powerup.y > HEIGHT + 20) powerup.destroy();
    });

    const parts = [];
    if (time < this.rapidUntil) parts.push(`RAPID ${Math.ceil((this.rapidUntil - time) / 1000)}s`);
    if (time < this.spreadUntil) parts.push(`SPREAD ${Math.ceil((this.spreadUntil - time) / 1000)}s`);
    if (time < this.shieldUntil) parts.push(`SHIELD ${Math.ceil((this.shieldUntil - time) / 1000)}s`);
    this.buffText.setText(parts.join('  '));
  }

  onBulletHitEnemy(bullet, enemySprite) {
    bullet.destroy();
    const enemy = this.enemies.find((e) => e.sprite === enemySprite);
    if (!enemy) return;
    this.killEnemy(enemy, enemy.state === 'diving');
  }

  onPlayerHitByBullet(bullet) {
    bullet.destroy();
    this.damagePlayer();
  }

  onPlayerCollideEnemy(enemySprite) {
    const enemy = this.enemies.find((e) => e.sprite === enemySprite);
    if (enemy) this.killEnemy(enemy, enemy.state === 'diving');
    this.damagePlayer();
  }

  damagePlayer() {
    if (this.gameOver || this.time.now < this.invulnUntil) return;
    if (this.time.now < this.shieldUntil) return;

    this.lives -= 1;
    this.updateLivesText();
    this.invulnUntil = this.time.now + 1500;
    this.explode(this.player.x, this.player.y, 0x53d0ff);

    if (this.lives <= 0) {
      this.endGame();
      return;
    }

    this.player.setPosition(WIDTH / 2, HEIGHT - 60);
    this.player.setAlpha(0.4);
    this.tweens.add({ targets: this.player, alpha: 1, duration: 1200 });
  }

  explode(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const particle = this.add.rectangle(x, y, 3, 3, color);
      const angle = Math.random() * Math.PI * 2;
      const speed = Phaser.Math.Between(40, 120);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        duration: 350,
        onComplete: () => particle.destroy(),
      });
    }
  }

  updateLivesText() {
    this.livesText.setText(`LIVES ${'♥'.repeat(Math.max(this.lives, 0))}`);
  }

  endGame() {
    this.gameOver = true;
    this.player.setVelocity(0, 0);
    this.physics.pause();

    this.add
      .text(WIDTH / 2, HEIGHT / 2 - 20, 'GAME OVER', { fontFamily: 'monospace', fontSize: '32px', color: '#ff5555' })
      .setOrigin(0.5);
    this.add
      .text(WIDTH / 2, HEIGHT / 2 + 20, `SCORE ${this.score}  -  Press SPACE or tap to restart`, {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.input.keyboard.once('keydown-SPACE', () => this.scene.restart());
    this.input.once('pointerdown', () => this.scene.restart());
  }
}
