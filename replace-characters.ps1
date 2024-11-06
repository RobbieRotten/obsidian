Get-ChildItem -Path "D:\Quartz\Law-UTS\content" -Filter *.md -Recurse |
ForEach-Object {
    (Get-Content $_.FullName) -replace '‘', '''' 
                             -replace '’', '''' 
                             -replace '“', '"' 
                             -replace '”', '"' | 
    Set-Content $_.FullName
}