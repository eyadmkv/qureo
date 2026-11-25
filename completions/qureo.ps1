Register-ArgumentCompleter -CommandName qureo -Native -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $commands = @('login','logout','me','check','courses','sync','export','solve','lessons','progress','chapter','questions','result','answers','answer','search','exercises','stats','database','dashboard','doctor','status','config','history','completion')
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'Command', $_)
    }
}
