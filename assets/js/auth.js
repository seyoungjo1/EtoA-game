/* ===========================================================
   auth.js — 계정 / 권한
   권한: admin(관리자) > staff(운영진) > member(회원) > pending(승인대기)
   =========================================================== */
const Auth = (() => {
  const ROLE_LABEL = { admin: '관리자', staff: '운영진', member: '회원', pending: '승인대기' };
  const RANK = { pending: 0, member: 1, staff: 2, admin: 3 };

  let current = null;

  /** 최초 실행 시 기본 관리자 계정(admin / 1111) 생성 */
  async function ensureSeed() {
    const users = Store.users();
    if (!users.some((u) => u.role === 'admin')) {
      users.push({
        username: 'admin',
        display: '관리자',
        passwordHash: await Util.hash('admin', '1111'),
        role: 'admin',
        createdAt: Date.now(),
        mustChangePassword: true,
      });
      Store.save();
    }
  }

  const findUser = (username) =>
    Store.users().find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase()) || null;

  async function login(username, password) {
    const u = findUser(username);
    if (!u) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
    const h = await Util.hash(u.username, password);
    if (h !== u.passwordHash) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
    current = u;
    Store.setCurrentUsername(u.username);
    return u;
  }

  async function signup({ username, display, password }) {
    const name = String(username).trim();
    if (!/^[A-Za-z0-9_.-]{3,20}$/.test(name)) throw new Error('아이디는 영문/숫자 3~20자로 입력해주세요.');
    if (findUser(name)) throw new Error('이미 사용 중인 아이디입니다.');
    const u = {
      username: name,
      display: String(display).trim() || name,
      passwordHash: await Util.hash(name, password),
      role: 'pending',
      createdAt: Date.now(),
    };
    Store.users().push(u);
    Store.save();
    return u;
  }

  function restore() {
    const name = Store.currentUsername();
    current = name ? findUser(name) : null;
    return current;
  }

  function logout() {
    current = null;
    Store.setCurrentUsername(null);
  }

  const user = () => current;
  const role = () => (current ? current.role : null);
  const can = (minRole) => !!current && RANK[current.role] >= RANK[minRole];
  const isAdmin = () => can('admin');
  const isStaff = () => can('staff');

  function setRole(username, newRole) {
    const u = findUser(username);
    if (!u) return false;
    if (!ROLE_LABEL[newRole]) return false;
    // 마지막 관리자의 권한을 내리지 못하도록 보호
    if (u.role === 'admin' && newRole !== 'admin') {
      const admins = Store.users().filter((x) => x.role === 'admin');
      if (admins.length <= 1) throw new Error('마지막 관리자는 권한을 변경할 수 없습니다.');
    }
    u.role = newRole;
    Store.save();
    if (current && current.username === u.username) current = u;
    return true;
  }

  function removeUser(username) {
    const u = findUser(username);
    if (!u) return false;
    if (u.role === 'admin' && Store.users().filter((x) => x.role === 'admin').length <= 1) {
      throw new Error('마지막 관리자는 삭제할 수 없습니다.');
    }
    if (current && current.username === u.username) throw new Error('현재 로그인한 계정은 삭제할 수 없습니다.');
    Store.get().users = Store.users().filter((x) => x.username !== u.username);
    Store.save();
    return true;
  }

  async function changePassword(username, current_, next) {
    const u = findUser(username);
    if (!u) throw new Error('계정을 찾을 수 없습니다.');
    if (!isAdmin() || (current && current.username === u.username)) {
      const h = await Util.hash(u.username, current_);
      if (h !== u.passwordHash) throw new Error('현재 비밀번호가 올바르지 않습니다.');
    }
    if (!next || next.length < 4) throw new Error('새 비밀번호는 4자 이상이어야 합니다.');
    u.passwordHash = await Util.hash(u.username, next);
    delete u.mustChangePassword;
    Store.save();
  }

  async function resetPassword(username, next) {
    const u = findUser(username);
    if (!u) throw new Error('계정을 찾을 수 없습니다.');
    u.passwordHash = await Util.hash(u.username, next);
    u.mustChangePassword = true;
    Store.save();
  }

  const pendingUsers = () => Store.users().filter((u) => u.role === 'pending');

  return {
    ROLE_LABEL, ensureSeed, login, signup, restore, logout, user, role,
    can, isAdmin, isStaff, setRole, removeUser, changePassword, resetPassword,
    pendingUsers, findUser,
  };
})();
