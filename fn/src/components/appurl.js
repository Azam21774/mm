import { Card } from "antd";

const AppUrl = () => {
     return (
    <div >
      <Card style={{margin:"20px"}}>
        
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Full Version is available at:
        </p>
        <a
          href="http://159.198.36.98"
          target="_blank"
          rel="noopener noreferrer"
          className="text-2xl font-semibold text-blue-600 dark:text-blue-400 hover:underline"
        >
          http://159.198.36.98
        </a>
      </Card>
    </div>
  );
}

export default AppUrl;