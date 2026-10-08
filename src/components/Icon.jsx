import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faAward,
  faBars,
  faBell,
  faBookOpen,
  faBullseye,
  faCheck,
  faCompass,
  faComments,
  faCrosshairs,
  faCrown,
  faGem,
  faHouseChimney,
  faLandmark,
  faLocationDot,
  faMapLocationDot,
  faMasksTheater,
  faMonument,
  faMountainSun,
  faPuzzlePiece,
  faSearch,
  faSeedling,
  faStar,
  faTrophy,
  faUsers,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

const icons = {
  all: faStar,
  architecture: faLandmark,
  bars: faBars,
  bell: faBell,
  book: faBookOpen,
  check: faCheck,
  compass: faCompass,
  culture: faMasksTheater,
  chat: faComments,
  memory: faMonument,
  flame: faCrown,
  history: faLandmark,
  home: faHouseChimney,
  map: faMapLocationDot,
  medal: faAward,
  memorial: faMonument,
  nature: faMountainSun,
  pin: faLocationDot,
  puzzle: faPuzzlePiece,
  search: faSearch,
  swords: faCrosshairs,
  star: faStar,
  target: faBullseye,
  traditions: faGem,
  trophy: faTrophy,
  users: faUsers,
  xmark: faXmark,
  leaf: faSeedling,
};

export default function Icon({ name, size = 20, className = '', title }) {
  return (
    <FontAwesomeIcon
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
      className={`app-icon ${className}`.trim()}
      icon={icons[name] || faStar}
      role={title ? 'img' : undefined}
      style={{ width: size, height: size }}
    />
  );
}
