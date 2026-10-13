import { useEffect, useState } from 'react';
import { api } from '../api.js';

const emptyQuestion = {
  mode: 'both', category: 'history', category_label: 'История',
  question: '', optionsText: '', correct: 0,
};
const emptyReward = { id: '', icon: '🏆', name: '', cost: 100 };
const categories = [
  ['history', 'История'], ['culture', 'Культура'], ['nature', 'Природа'],
  ['traditions', 'Традиции'], ['architecture', 'Архитектура'], ['memorial', 'Память'],
];

export default function AdminContentManager({ kind }) {
  const isQuestion = kind === 'questions';
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(isQuestion ? emptyQuestion : emptyReward);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try { setItems(await (isQuestion ? api.getBattleQuestions() : api.getRewards())); }
    catch (err) { setError(err.message); }
  };

  useEffect(() => {
    (isQuestion ? api.getBattleQuestions() : api.getRewards())
      .then(setItems).catch((err) => setError(err.message));
  }, [isQuestion]);

  const change = (event) => {
    const { name, value } = event.target;
    if (name === 'category') {
      setForm((prev) => ({ ...prev, category: value, category_label: categories.find(([id]) => id === value)?.[1] || value }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const reset = () => { setEditingId(null); setForm(isQuestion ? emptyQuestion : emptyReward); };

  const submit = async (event) => {
    event.preventDefault();
    setError(''); setMessage('');
    try {
      if (isQuestion) {
        const options = form.optionsText.split('\n').map((value) => value.trim()).filter(Boolean);
        const correct = Number(form.correct);
        if (options.length < 2 || options.length > 6 || correct < 0 || correct >= options.length) {
          throw new Error('Нужно от 2 до 6 вариантов и правильный ответ');
        }
        const payload = { ...form, options, correct };
        delete payload.optionsText;
        if (editingId !== null) await api.updateBattleQuestion(editingId, payload);
        else await api.createBattleQuestion(payload);
      } else {
        const payload = { ...form, cost: Number(form.cost) };
        if (editingId !== null) await api.updateReward(editingId, payload);
        else await api.createReward(payload);
      }
      setMessage(editingId !== null ? 'Изменения сохранены' : 'Добавлено');
      reset(); await load();
    } catch (err) { setError(err.message); }
  };

  const edit = (item) => {
    setEditingId(item.id);
    setForm(isQuestion ? { ...item, optionsText: item.options.join('\n') } : { ...item });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (item) => {
    if (!window.confirm(`Удалить «${isQuestion ? item.question : item.name}»?`)) return;
    setError(''); setMessage('');
    try {
      if (isQuestion) await api.deleteBattleQuestion(item.id);
      else await api.deleteReward(item.id);
      setMessage('Удалено'); await load();
    } catch (err) { setError(err.message); }
  };

  return <>
    {message && <div className="alert success">{message}</div>}
    {error && <div className="alert error">{error}</div>}
    <div className="admin-form-card">
      <div className="admin-form-head"><div><span className="section-kicker">{isQuestion ? 'Баттлы' : 'Каталог'}</span>
        <h3>{editingId !== null ? 'Редактировать' : 'Добавить'} {isQuestion ? 'вопрос' : 'награду'}</h3></div></div>
      <form className="admin-form" onSubmit={submit}>
        {isQuestion ? <>
          <label className="form-row"><span className="muted">Где использовать</span>
            <select name="mode" value={form.mode} onChange={change}>
              <option value="both">Обычные и командные баттлы</option><option value="duel">Обычные баттлы</option><option value="team">Командные баттлы</option>
            </select></label>
          <label className="form-row"><span className="muted">Тема</span>
            <select name="category" value={form.category} onChange={change}>
              {categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select></label>
          <label className="form-row"><span className="muted">Вопрос</span><input name="question" value={form.question} onChange={change} required /></label>
          <label className="form-row"><span className="muted">Варианты ответов — каждый с новой строки</span>
            <textarea name="optionsText" value={form.optionsText} onChange={change} rows="6" required /></label>
          <label className="form-row"><span className="muted">Номер правильного ответа (первый — 1)</span>
            <input type="number" min="1" max="6" value={Number(form.correct) + 1}
              onChange={(event) => setForm((prev) => ({ ...prev, correct: Number(event.target.value) - 1 }))} required /></label>
          <small>Новые вопросы попадают в новые баттлы. Уже созданные баттлы сохраняют прежний набор.</small>
        </> : <>
          <label className="form-row"><span className="muted">Код награды (латиница, цифры, дефис)</span>
            <input name="id" value={form.id} onChange={change} pattern="[a-z0-9-]+" disabled={editingId !== null} required /></label>
          <label className="form-row"><span className="muted">Значок</span><input name="icon" value={form.icon} onChange={change} required /></label>
          <label className="form-row"><span className="muted">Название</span><input name="name" value={form.name} onChange={change} required /></label>
          <label className="form-row"><span className="muted">Стоимость в баллах</span>
            <input name="cost" type="number" min="0" value={form.cost} onChange={change} required /></label>
          <small>Награды, которые уже получены пользователями, нельзя удалить или переоценить.</small>
        </>}
        <div className="form-actions"><button className="btn-primary" type="submit">{editingId !== null ? 'Сохранить' : 'Добавить'}</button>
          {editingId !== null && <button className="btn-ghost" type="button" onClick={reset}>Отмена</button>}</div>
      </form>
    </div>
    <div className="admin-list-head"><h3>{isQuestion ? 'Вопросы' : 'Награды'} ({items.length})</h3></div>
    <div className="admin-list">{items.map((item) => <div className="admin-list-item" key={item.id}>
      <div><strong>{isQuestion ? item.question : `${item.icon} ${item.name}`}</strong>
        <span className="admin-list-meta">{isQuestion
          ? `${item.category_label} · ${item.mode === 'both' ? 'оба режима' : item.mode === 'duel' ? 'баттлы' : 'командные баттлы'} · верный ответ: ${item.options[item.correct]}`
          : `${item.id} · ${item.cost} баллов`}</span></div>
      <div className="admin-list-actions"><button className="btn-ghost" onClick={() => edit(item)}>Изменить</button>
        <button className="btn-danger" onClick={() => remove(item)}>Удалить</button></div>
    </div>)}</div>
  </>;
}
